import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const { data: { user }, error: sessionError } = await supabase.auth.getUser();
  if (sessionError || !user) return NextResponse.json({ error: "Sign in again before deleting your account." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const [{ data: photos, error: photosError }, { data: profile, error: profileError }] = await Promise.all([
      admin.from("listing_photos").select("storage_path").eq("owner_id", user.id),
      admin.from("profiles").select("avatar_path").eq("id", user.id).maybeSingle(),
    ]);
    if (photosError) throw photosError;
    if (profileError) throw profileError;

    const photoPaths = (photos || []).map((photo) => photo.storage_path);
    const { data: reservationPhotoSnapshots, error: snapshotError } = await admin.from("reservations")
      .select("photo_paths_snapshot").eq("donor_id", user.id);
    if (snapshotError) throw snapshotError;
    const retainedPaths = new Set((reservationPhotoSnapshots || []).flatMap((reservation) => reservation.photo_paths_snapshot || []));
    const removablePaths = photoPaths.filter((path) => !retainedPaths.has(path));
    if (removablePaths.length) {
      const { error: photoCleanupError } = await admin.storage.from("listing-photos").remove(removablePaths);
      if (photoCleanupError) throw photoCleanupError;
    }
    if (profile?.avatar_path) {
      const { error: avatarCleanupError } = await admin.storage.from("avatars").remove([profile.avatar_path]);
      if (avatarCleanupError) throw avatarCleanupError;
    }

    const { data: activeReservations, error: activeReservationsError } = await admin.from("reservations")
      .select("listing_id").eq("claimant_id", user.id).eq("status", "pending");
    if (activeReservationsError) throw activeReservationsError;
    const claimedListingIds = Array.from(new Set((activeReservations || []).map((reservation) => reservation.listing_id)));

    const { error: claimantReservationsError } = await admin.from("reservations").delete().eq("claimant_id", user.id);
    if (claimantReservationsError) throw claimantReservationsError;
    if (claimedListingIds.length) {
      const { error: unreserveError } = await admin.from("listings").update({ status: "available" })
        .in("id", claimedListingIds).eq("status", "reserved");
      if (unreserveError) throw unreserveError;
    }
    // Reservations for the user's own listings remain as cancelled history.
    // The database trigger snapshots that state before the listings cascade away.
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteUserError) throw deleteUserError;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("account deletion failed:", error);
    return NextResponse.json({ error: "We couldn't delete the account. Please contact support@swaprightapp.com." }, { status: 500 });
  }
}
