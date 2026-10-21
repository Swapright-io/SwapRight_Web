import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(_request: Request, { params }: { params: { listingId: string } }) {
  const supabase = await createClient();
  const { data: { user }, error: sessionError } = await supabase.auth.getUser();
  if (sessionError || !user) return NextResponse.json({ error: "Sign in again before deleting a listing." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const { data: listing, error: listingError } = await admin.from("listings")
      .select("id,owner_id").eq("id", params.listingId).maybeSingle();
    if (listingError) throw listingError;
    if (!listing || listing.owner_id !== user.id) {
      return NextResponse.json({ error: "That listing was not found in your account." }, { status: 404 });
    }

    const { data: photos, error: photosError } = await admin.from("listing_photos")
      .select("storage_path").eq("listing_id", listing.id);
    if (photosError) throw photosError;
    const photoPaths = (photos || []).map((photo) => photo.storage_path);
    if (photoPaths.length) {
      const { error: photoCleanupError } = await admin.storage.from("listing-photos").remove(photoPaths);
      if (photoCleanupError) throw photoCleanupError;
    }

    // Remove the hold so the claimant is not left with a reservation for a deleted item.
    const { error: reservationError } = await admin.from("reservations").delete().eq("listing_id", listing.id);
    if (reservationError) throw reservationError;

    const { error: deleteError } = await admin.from("listings").delete()
      .eq("id", listing.id).eq("owner_id", user.id);
    if (deleteError) throw deleteError;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("listing deletion failed:", error);
    return NextResponse.json({ error: "We couldn't delete this listing. Please try again." }, { status: 500 });
  }
}
