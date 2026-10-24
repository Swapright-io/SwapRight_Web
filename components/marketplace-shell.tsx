"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, BellIcon, BrowseIcon, Check, ChevronRightIcon, FilterIcon, HelpIcon, InboxIcon, LocationIcon, LockIcon, NoResultsIcon, PlusIcon, ProfileIcon, ReservationIcon, SearchIcon, ShieldCheckIcon, FlagIcon, TrashIcon, UsersIcon } from "@/components/icons";

const CATEGORIES = ["Furniture", "Electronics", "Books", "Clothing", "Kitchen", "Other"];
const CONDITIONS = ["new", "like_new", "good", "fair"] as const;
const PRICE_OPTIONS = ["Any price", "Under $10", "Under $20", "Under $50"];
type ListingType = "free" | "for_sale";
type Tab = "browse" | "reservations" | "inbox" | "profile";
type Listing = {
  id: string; owner_id: string; title: string; description: string; category: string;
  condition: string; listing_type: ListingType; asking_price_cents: number | null;
  pickup_area: string; status: string; created_at: string; owner_name?: string; photos?: string[]; photoPaths?: string[];
};
type Reservation = {
  id: string; listing_id: string | null; claimant_id: string; donor_id: string | null;
  status: string; expires_at: string; created_at: string; claim_requested_at: string | null;
  donor_reviewed_at: string | null; claim_confirmation_status: "not_requested" | "awaiting_donor" | "confirmed" | "declined";
  resolution_reason: string | null; pickup_area_snapshot: string | null;
  listing_title_snapshot: string | null; listing_description_snapshot: string | null;
  listing_category_snapshot: string | null; listing_condition_snapshot: string | null;
  listing_type_snapshot: ListingType | null; asking_price_snapshot_cents: number | null;
  photo_paths_snapshot: string[]; claimant_name?: string; donor_name?: string; listing: Listing | null;
};
type ReservationTab = "pending" | "claimed" | "cancelled";
type ReservationDetailMode = "receiver" | "donor";
type Conversation = { id: string; listing_id: string; owner_id: string; interested_user_id: string };
type Message = { id: string; body: string; sender_id: string; created_at: string; read_at: string | null };
type Profile = {
  email: string; display_name: string; dorm_building: string | null;
  university_domain: string; avatar_path: string | null; avatar_url?: string | null; onboarding_complete: boolean;
};
type ProfileScreen = "account" | "notifications" | "blocked" | "guidelines" | "privacy" | "support";
type NotificationRow = {
  id: string; notification_type: "reservation" | "listing_report" | "message" | "claim_confirmation"; title: string; body: string;
  listing_id: string | null; metadata: { reservation_id?: string; confirmed?: boolean; reservee_name?: string; reservee_avatar_path?: string | null; sender_name?: string; sender_avatar_path?: string | null; warning?: string };
  read_at: string | null; created_at: string; avatar_url?: string | null;
};
type NotificationPreferences = { reservation_alerts: boolean; message_alerts: boolean; safety_alerts: boolean };
type BlockedPerson = { id: string; display_name: string; created_at: string };
const defaultNotificationPreferences: NotificationPreferences = { reservation_alerts: true, message_alerts: true, safety_alerts: true };
const REPORT_REASONS = [
  { id: "prohibited_item", label: "Prohibited item", hint: "Weapons, alcohol or drugs, prescription medication, or other restricted items." },
  { id: "misleading_or_scam", label: "Misleading or scam", hint: "Incorrect condition, fake or stolen item, non-functional product, or misleading photos." },
  { id: "harassment", label: "Harassment or abusive conduct", hint: "Hate speech, personal insults, discriminatory content, or threats." },
  { id: "inappropriate", label: "Inappropriate item or content", hint: "Sexual, graphic, unsafe, or otherwise inappropriate listing content." },
  { id: "other", label: "Other concern", hint: "Something else that needs campus safety review." },
];
const emptyListing = { title: "", description: "", category: "", condition: "", listingType: "" as ListingType | "", price: "", pickupArea: "" };

export default function MarketplaceShell({ user }: { user: User }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<Tab>("browse");
  const [listings, setListings] = useState<Listing[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [reservationTab, setReservationTab] = useState<ReservationTab>("pending");
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [reservationDetailMode, setReservationDetailMode] = useState<ReservationDetailMode>("receiver");
  const [confirmClaimPrompt, setConfirmClaimPrompt] = useState(false);
  const [reservationTouchStart, setReservationTouchStart] = useState<number | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationLabels, setConversationLabels] = useState<Record<string, { listingTitle: string; participantName: string }>>({});
  const [unreadConversations, setUnreadConversations] = useState<Record<string, boolean>>({});
  const [profile, setProfile] = useState<Profile | null>(null);
  const [institution, setInstitution] = useState("University marketplace");
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [listingType, setListingType] = useState<"all" | ListingType>("all");
  const [categories, setCategories] = useState<string[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [price, setPrice] = useState("Any price");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingListing, setEditingListing] = useState<Listing | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [keptPhotoPaths, setKeptPhotoPaths] = useState<string[]>([]);
  const [newListing, setNewListing] = useState(emptyListing);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState("");
  const [chatViewport, setChatViewport] = useState<{ top: number; height: number } | null>(null);
  const messageThreadRef = useRef<HTMLDivElement | null>(null);
  const chatWasAtBottom = useRef(true);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [selectedPickup, setSelectedPickup] = useState("");
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [profileScreen, setProfileScreen] = useState<ProfileScreen>("account");
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [notificationPreferences, setNotificationPreferences] = useState(defaultNotificationPreferences);
  const [blockedPeople, setBlockedPeople] = useState<BlockedPerson[]>([]);
  const [reportingListing, setReportingListing] = useState<Listing | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [deleteAccountPrompt, setDeleteAccountPrompt] = useState(false);
  const [signOutPrompt, setSignOutPrompt] = useState(false);
  const [deleteListingPrompt, setDeleteListingPrompt] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | "unsupported">("default");
  const [error, setError] = useState("");
  const openNotificationRef = useRef<(notification: NotificationRow) => Promise<void>>(async () => {});
  const loadListingsRef = useRef<(showLoading?: boolean) => Promise<void>>(async () => {});
  const loadReservationsRef = useRef<() => Promise<Reservation[]>>(async () => []);
  const loadNotificationsRef = useRef<() => Promise<void>>(async () => {});
  const loadProfileRef = useRef<() => Promise<void>>(async () => {});
  const loadConversationsRef = useRef<() => Promise<void>>(async () => {});
  const loadBlockedPeopleRef = useRef<() => Promise<void>>(async () => {});

  const name = profile?.display_name || user.user_metadata?.display_name || user.email?.split("@")[0] || "Student";
  const initials = name.split(/\s+/).map((part: string) => part[0]).slice(0, 2).join("").toUpperCase();
  const listingFormReady = newListing.title.trim().length >= 3
    && newListing.description.trim().length >= 8
    && Boolean(newListing.category && newListing.condition && newListing.listingType)
    && newListing.pickupArea.trim().length >= 2
    && (newListing.listingType !== "for_sale" || Number(newListing.price) > 0)
    && (editingListing ? keptPhotoPaths.length + imageFiles.length > 0 : imageFiles.length > 0);

  async function loadListings(showLoading = true) {
    if (showLoading) setLoading(true);
    const { data, error: listingError } = await supabase.from("listings")
      .select("id,owner_id,title,description,category,condition,listing_type,asking_price_cents,pickup_area,status,created_at")
      .eq("status", "available").order("created_at", { ascending: false });
    if (listingError) { setError(listingError.message); if (showLoading) setLoading(false); return; }
    const rows = (data || []) as Listing[];
    const ownerIds = Array.from(new Set(rows.map((row) => row.owner_id)));
    const { data: profiles } = ownerIds.length
      ? await supabase.from("public_profiles").select("id,display_name").in("id", ownerIds)
      : { data: [] };
    const names = new Map<string, string>((profiles || []).map((person: { id: string; display_name: string }) => [person.id, person.display_name] as [string, string]));
    const ids = rows.map((row) => row.id);
    const { data: photos } = ids.length ? await supabase.from("listing_photos").select("listing_id,storage_path,sort_order").in("listing_id", ids).order("sort_order") : { data: [] };
    const urls = new Map<string, string[]>();
    const paths = new Map<string, string[]>();
    for (const photo of photos || []) {
      const current = urls.get(photo.listing_id) || [];
      current.push(supabase.storage.from("listing-photos").getPublicUrl(photo.storage_path).data.publicUrl);
      urls.set(photo.listing_id, current);
      const currentPaths = paths.get(photo.listing_id) || [];
      currentPaths.push(photo.storage_path);
      paths.set(photo.listing_id, currentPaths);
    }
    setListings(rows.map((row) => ({ ...row, owner_name: names.get(row.owner_id) || "Campus student", photos: urls.get(row.id) || [], photoPaths: paths.get(row.id) || [] })));
    if (showLoading) setLoading(false);
  }

  async function loadReservations(): Promise<Reservation[]> {
    const { data, error: reservationError } = await supabase.from("reservations")
      .select("id,listing_id,claimant_id,donor_id,status,expires_at,created_at,claim_requested_at,donor_reviewed_at,claim_confirmation_status,resolution_reason,pickup_area_snapshot,listing_title_snapshot,listing_description_snapshot,listing_category_snapshot,listing_condition_snapshot,listing_type_snapshot,asking_price_snapshot_cents,photo_paths_snapshot,listings(id,owner_id,title,description,category,condition,listing_type,asking_price_cents,pickup_area,status,created_at,listing_photos(storage_path,sort_order))")
      .or(`claimant_id.eq.${user.id},donor_id.eq.${user.id}`).order("created_at", { ascending: false });
    if (reservationError) { setError(reservationError.message); return []; }
    const rows = (data || []) as unknown as Array<Omit<Reservation, "listing" | "claimant_name" | "donor_name"> & {
      listings: (Omit<Listing, "photos" | "photoPaths" | "owner_name"> & { listing_photos?: { storage_path: string; sort_order: number }[] }) | null;
    }>;
    const profileIds = Array.from(new Set(rows.flatMap((row) => [row.claimant_id, row.donor_id || ""]).filter((id) => id && id !== user.id)));
    const { data: people } = profileIds.length
      ? await supabase.from("public_profiles").select("id,display_name").in("id", profileIds)
      : { data: [] };
    const names = new Map<string, string>((people || []).map((person: { id: string; display_name: string }) => [person.id, person.display_name]));
    const hydrated = rows.map((row) => {
      const live = row.listings;
      const paths = row.photo_paths_snapshot?.length
        ? row.photo_paths_snapshot
        : (live?.listing_photos || []).slice().sort((a, b) => a.sort_order - b.sort_order).map((photo) => photo.storage_path);
      const listing: Listing = {
        id: live?.id || row.listing_id || `reservation-${row.id}`,
        owner_id: live?.owner_id || row.donor_id || "",
        title: live?.title || row.listing_title_snapshot || "Removed listing",
        description: live?.description || row.listing_description_snapshot || "",
        category: live?.category || row.listing_category_snapshot || "Other",
        condition: live?.condition || row.listing_condition_snapshot || "good",
        listing_type: live?.listing_type || row.listing_type_snapshot || "free",
        asking_price_cents: live?.asking_price_cents ?? row.asking_price_snapshot_cents,
        pickup_area: live?.pickup_area || row.pickup_area_snapshot || "Pickup details unavailable",
        status: live?.status || (row.status === "pending" ? "reserved" : row.status),
        created_at: live?.created_at || row.created_at,
        owner_name: row.donor_id ? names.get(row.donor_id) || "Campus student" : "Donor account removed",
        photoPaths: paths,
        photos: paths.map((path) => supabase.storage.from("listing-photos").getPublicUrl(path).data.publicUrl),
      };
      return {
        ...row,
        listing,
        claimant_name: names.get(row.claimant_id) || (row.claimant_id === user.id ? name : "Campus student"),
        donor_name: row.donor_id ? names.get(row.donor_id) || "Campus student" : "Donor account removed",
      };
    });
    setReservations(hydrated);
    return hydrated;
  }

  async function loadProfile() {
    const { data, error: profileError } = await supabase.from("profiles")
      .select("email,display_name,dorm_building,university_domain,avatar_path,onboarding_complete")
      .eq("id", user.id).maybeSingle();
    if (profileError) { setError(profileError.message); return; }
    if (!data) return;
    let avatarUrl: string | null = null;
    if (data.avatar_path) {
      const { data: signedAvatar } = await supabase.storage.from("avatars").createSignedUrl(data.avatar_path, 3600);
      avatarUrl = signedAvatar?.signedUrl || null;
    }
    setProfile({ ...(data as Profile), avatar_url: avatarUrl });
    if (data.university_domain) {
      const response = await fetch("/api/auth/check-domain", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email }),
      });
      const school = await response.json() as { institution?: string | null };
      setInstitution(school.institution || data.university_domain);
    }
  }

  async function loadConversations() {
    const { data, error: conversationError } = await supabase.from("conversations")
      .select("id,listing_id,owner_id,interested_user_id")
      .or(`owner_id.eq.${user.id},interested_user_id.eq.${user.id}`).order("created_at", { ascending: false });
    if (conversationError) { setError(conversationError.message); return; }
    const rows = (data || []) as Conversation[];
    setConversations(rows);
    const listingIds = Array.from(new Set(rows.map((row) => row.listing_id)));
    const otherIds = Array.from(new Set(rows.map((row) => row.owner_id === user.id ? row.interested_user_id : row.owner_id)));
    const [listingResult, peopleResult, unreadResult] = await Promise.all([
      listingIds.length ? supabase.from("listings").select("id,title").in("id", listingIds) : Promise.resolve({ data: [] }),
      otherIds.length ? supabase.from("public_profiles").select("id,display_name").in("id", otherIds) : Promise.resolve({ data: [] }),
      listingIds.length ? supabase.from("messages").select("conversation_id").in("conversation_id", rows.map((row) => row.id)).neq("sender_id", user.id).is("read_at", null) : Promise.resolve({ data: [] }),
    ]);
    const titles = new Map<string, string>((listingResult.data || []).map((row: { id: string; title: string }) => [row.id, row.title] as [string, string]));
    const people = new Map<string, string>((peopleResult.data || []).map((row: { id: string; display_name: string }) => [row.id, row.display_name] as [string, string]));
    setConversationLabels(Object.fromEntries(rows.map((row) => {
      const otherId = row.owner_id === user.id ? row.interested_user_id : row.owner_id;
      return [row.id, {
        listingTitle: titles.get(row.listing_id) || "Item",
        participantName: people.get(otherId) || "Student",
      }] as [string, { listingTitle: string; participantName: string }];
    })));
    const unreadIds = new Set((unreadResult.data || []).map((row: { conversation_id: string }) => row.conversation_id));
    setUnreadConversations(Object.fromEntries(rows.map((row) => [row.id, unreadIds.has(row.id)])));
  }

  async function loadNotifications() {
    const { data, error: notificationError } = await supabase.from("notifications")
      .select("id,notification_type,title,body,listing_id,metadata,read_at,created_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
    if (notificationError) { setError(notificationError.message); return; }
    const rows = (data || []) as NotificationRow[];
    const enriched = await Promise.all(rows.map(async (row) => {
      const path = row.metadata?.reservee_avatar_path || row.metadata?.sender_avatar_path;
      if (!path || (row.notification_type !== "reservation" && row.notification_type !== "message")) return row;
      const { data: signed } = await supabase.storage.from("avatars").createSignedUrl(path, 3600);
      return { ...row, avatar_url: signed?.signedUrl || null };
    }));
    setNotifications(enriched);
  }

  async function loadNotificationPreferences() {
    const { data, error: preferenceError } = await supabase.from("notification_preferences")
      .upsert({ user_id: user.id }, { onConflict: "user_id" })
      .select("reservation_alerts,message_alerts,safety_alerts").single();
    if (preferenceError) { setError(preferenceError.message); return; }
    setNotificationPreferences(data as NotificationPreferences);
  }

  async function loadBlockedPeople() {
    const { data, error: blocksError } = await supabase.from("blocks").select("blocked_id,created_at")
      .eq("blocker_id", user.id).order("created_at", { ascending: false });
    if (blocksError) { setError(blocksError.message); return; }
    const rows = data || [];
    const ids = rows.map((row) => row.blocked_id);
    const { data: profiles } = ids.length ? await supabase.from("public_profiles").select("id,display_name").in("id", ids) : { data: [] };
    const names = new Map<string, string>((profiles || []).map((row: { id: string; display_name: string }) => [row.id, row.display_name] as [string, string]));
    setBlockedPeople(rows.map((row) => ({ id: row.blocked_id, created_at: row.created_at, display_name: names.get(row.blocked_id) || "Student" })));
  }

  function openProfileScreen(screen: ProfileScreen) {
    setProfileScreen(screen);
    setError("");
    if (screen === "notifications") { void loadNotifications(); void loadNotificationPreferences(); }
    if (screen === "blocked") void loadBlockedPeople();
  }

  async function updateNotificationPreference(key: keyof NotificationPreferences, value: boolean) {
    const previous = notificationPreferences;
    const next = { ...previous, [key]: value };
    setNotificationPreferences(next);
    const { error: updateError } = await supabase.from("notification_preferences")
      .upsert({ user_id: user.id, ...next }, { onConflict: "user_id" });
    if (updateError) { setNotificationPreferences(previous); setError(updateError.message); }
  }

  async function allowBrowserNotifications() {
    if (!("Notification" in window)) { setBrowserPermission("unsupported"); return; }
    setBrowserPermission(await Notification.requestPermission());
  }

  async function markNotificationRead(notification: NotificationRow) {
    if (notification.read_at) return;
    const readAt = new Date().toISOString();
    const { error: readError } = await supabase.from("notifications").update({ read_at: readAt }).eq("id", notification.id);
    if (readError) setError(readError.message);
    else setNotifications((current) => current.map((row) => row.id === notification.id ? { ...row, read_at: readAt } : row));
  }

  async function openReservationDetail(reservation: Reservation, mode: ReservationDetailMode) {
    setSelectedReservation(reservation);
    setReservationDetailMode(mode);
    setSelectedListing(reservation.listing);
    setGalleryIndex(0);
    setError("");
  }

  async function openNotification(notification: NotificationRow) {
    await markNotificationRead(notification);
    if (notification.notification_type !== "claim_confirmation" || !notification.metadata?.reservation_id) return;
    let reservation = reservations.find((row) => row.id === notification.metadata.reservation_id);
    if (!reservation) {
      const loaded = await loadReservations();
      reservation = loaded.find((row) => row.id === notification.metadata.reservation_id);
    }
    if (!reservation) { setError("We couldn't open that reservation. It may have been removed."); return; }
    const mode: ReservationDetailMode = reservation.donor_id === user.id ? "donor" : "receiver";
    await openReservationDetail(reservation, mode);
  }
  openNotificationRef.current = openNotification;
  loadListingsRef.current = loadListings;
  loadReservationsRef.current = loadReservations;
  loadNotificationsRef.current = loadNotifications;
  loadProfileRef.current = loadProfile;
  loadConversationsRef.current = loadConversations;
  loadBlockedPeopleRef.current = loadBlockedPeople;

  async function unblockPerson(person: BlockedPerson) {
    const { error: unblockError } = await supabase.from("blocks").delete().eq("blocker_id", user.id).eq("blocked_id", person.id);
    if (unblockError) setError(unblockError.message);
    else setBlockedPeople((current) => current.filter((row) => row.id !== person.id));
  }

  async function submitListingReport(event: FormEvent) {
    event.preventDefault();
    if (!reportingListing || !reportReason) return;
    setBusy(true); setError("");
    const { error: reportError } = await supabase.from("reports").insert({
      reporter_id: user.id, target_type: "listing", listing_id: reportingListing.id,
      reported_user_id: reportingListing.owner_id, reason: reportReason, details: reportDetails.trim() || null,
    });
    if (reportError) setError(reportError.message);
    else setReportSubmitted(true);
    setBusy(false);
  }

  async function deleteAccount() {
    setBusy(true); setError("");
    const response = await fetch("/api/account/delete", { method: "POST" });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setError(result.error || "We couldn't delete your account."); setBusy(false); return; }
    await supabase.auth.signOut();
    router.replace("/"); router.refresh();
  }

  async function deleteListing() {
    if (!selectedListing || selectedListing.owner_id !== user.id) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/listings/${selectedListing.id}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setError(result.error || "We couldn't delete this listing.");
      setBusy(false);
      return;
    }
    setDeleteListingPrompt(false);
    setSelectedListing(null);
    await Promise.all([loadListings(), loadReservations(), loadConversations()]);
    setBusy(false);
  }

  useEffect(() => { void Promise.all([loadListingsRef.current(), loadReservationsRef.current(), loadProfileRef.current(), loadConversationsRef.current(), loadNotificationsRef.current(), loadBlockedPeopleRef.current()]); }, []);
  useEffect(() => {
    if (tab !== "browse") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadListingsRef.current(false);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [tab]);
  useEffect(() => {
    if (tab !== "reservations") return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadReservationsRef.current(); }, 30000);
    return () => window.clearInterval(timer);
  }, [tab]);
  useEffect(() => {
    if (tab !== "inbox") return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadConversationsRef.current(); }, 15000);
    return () => window.clearInterval(timer);
  }, [tab]);
  useEffect(() => {
    if ("Notification" in window) setBrowserPermission(Notification.permission);
    else setBrowserPermission("unsupported");
    let cursor = new Date().toISOString();
    let firstPoll = true;
    const pollNotifications = async () => {
      const { data } = await supabase.from("notifications").select("id,title,body,created_at,notification_type,listing_id,metadata,read_at")
        .eq("user_id", user.id).gt("created_at", cursor).order("created_at", { ascending: true });
      if (data?.length) cursor = data[data.length - 1].created_at;
      if (!firstPoll && browserPermission === "granted") {
        for (const item of data || []) {
          const notice = new Notification(item.title, { body: item.body, tag: item.id });
          notice.onclick = () => {
            window.focus();
            void openNotificationRef.current(item as NotificationRow);
            notice.close();
          };
        }
      }
      firstPoll = false;
      if (profileScreen === "notifications") void loadNotificationsRef.current();
    };
    void pollNotifications();
    const timer = window.setInterval(() => { void pollNotifications(); }, 20000);
    return () => window.clearInterval(timer);
  }, [browserPermission, profileScreen, supabase, user.id]);
  useEffect(() => () => { imagePreviews.forEach((url) => URL.revokeObjectURL(url)); }, [imagePreviews]);
  useEffect(() => {
    if (!conversation) return;
    const refreshMessages = async () => {
      const { data } = await supabase.from("messages").select("id,body,sender_id,created_at,read_at")
        .eq("conversation_id", conversation.id).order("created_at");
      if (data) {
        const unreadIds = data.filter((row) => row.sender_id !== user.id && !row.read_at).map((row) => row.id);
        if (unreadIds.length) {
          const readAt = new Date().toISOString();
          const { error: readError } = await supabase.from("messages").update({ read_at: readAt })
            .in("id", unreadIds).is("read_at", null);
          if (!readError) setMessages(data.map((row) => unreadIds.includes(row.id) ? { ...row, read_at: readAt } : row) as Message[]);
          else setMessages(data as Message[]);
        } else setMessages(data as Message[]);
      }
    };
    const timer = window.setInterval(() => { void refreshMessages(); }, 4000);
    return () => window.clearInterval(timer);
  }, [conversation, supabase, user.id]);
  useEffect(() => {
    if (!conversation) { setChatViewport(null); return; }
    const visualViewport = window.visualViewport;
    const updateViewport = () => setChatViewport({
      top: visualViewport?.offsetTop ?? 0,
      height: visualViewport?.height ?? window.innerHeight,
    });
    updateViewport();
    visualViewport?.addEventListener("resize", updateViewport);
    visualViewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);
    return () => {
      visualViewport?.removeEventListener("resize", updateViewport);
      visualViewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
    };
  }, [conversation]);
  useEffect(() => {
    if (chatWasAtBottom.current && messageThreadRef.current) {
      messageThreadRef.current.scrollTop = messageThreadRef.current.scrollHeight;
    }
  }, [chatViewport, messages.length, conversation?.id]);

  const visibleListings = listings.filter((listing) => {
    const haystack = `${listing.title} ${listing.description} ${listing.category} ${listing.pickup_area}`.toLowerCase();
    const priceLimit = price === "Under $10" ? 1000 : price === "Under $20" ? 2000 : price === "Under $50" ? 5000 : null;
    return (!query || haystack.includes(query.toLowerCase()))
      && (listingType === "all" || listing.listing_type === listingType)
      && (!categories.length || categories.includes(listing.category))
      && (!conditions.length || conditions.includes(listing.condition))
      && (priceLimit === null || listing.listing_type === "free" || (listing.asking_price_cents !== null && listing.asking_price_cents < priceLimit));
  });
  const receiverReservations = reservations.filter((row) => row.claimant_id === user.id);
  const reservationBuckets: Record<ReservationTab, Reservation[]> = {
    pending: receiverReservations.filter((row) => row.status === "pending"),
    claimed: receiverReservations.filter((row) => row.status === "completed"),
    cancelled: receiverReservations.filter((row) => row.status === "cancelled" || row.status === "expired"),
  };

  function swipeReservations(endX: number) {
    if (reservationTouchStart === null) return;
    const delta = endX - reservationTouchStart;
    const tabs: ReservationTab[] = ["pending", "claimed", "cancelled"];
    const current = tabs.indexOf(reservationTab);
    if (Math.abs(delta) > 55) setReservationTab(tabs[Math.max(0, Math.min(tabs.length - 1, current + (delta < 0 ? 1 : -1)))]);
    setReservationTouchStart(null);
  }

  async function publishListing(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const hasPhotos = editingListing ? keptPhotoPaths.length + imageFiles.length > 0 : imageFiles.length > 0;
    if (!newListing.title.trim() || !newListing.description.trim() || !newListing.category || !newListing.condition || !newListing.listingType || !newListing.pickupArea.trim() || !hasPhotos || (newListing.listingType === "for_sale" && !newListing.price)) {
      setError("Complete every required field and upload at least one item photo before publishing."); setBusy(false); return;
    }
    const amount = newListing.listingType === "for_sale" ? Math.round(Number(newListing.price) * 100) : null;
    const values = {
      title: newListing.title.trim(), description: newListing.description.trim(), category: newListing.category,
      condition: newListing.condition, listing_type: newListing.listingType as ListingType,
      asking_price_cents: amount, pickup_area: newListing.pickupArea.trim(),
    };
    let listingId = editingListing?.id || "";
    if (editingListing) {
      const { error: updateError } = await supabase.from("listings").update(values).eq("id", listingId).eq("owner_id", user.id);
      if (updateError) { setError(updateError.message); setBusy(false); return; }
    } else {
      const { data: created, error: insertError } = await supabase.from("listings").insert({ owner_id: user.id, ...values }).select("id").single();
      if (insertError || !created) { setError(insertError?.message || "We couldn't create the listing."); setBusy(false); return; }
      listingId = created.id;
    }

    const uploadedPaths: string[] = [];
    const photoRows: { listing_id: string; owner_id: string; storage_path: string; sort_order: number }[] = [];
    let photoErrorMessage: string | null = null;
    for (let index = 0; index < imageFiles.length; index += 1) {
      const file = imageFiles[index];
      const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${user.id}/${listingId}/${crypto.randomUUID()}.${extension}`;
      const { error: storageError } = await supabase.storage.from("listing-photos").upload(path, file, { contentType: file.type, upsert: false });
      if (storageError) { photoErrorMessage = storageError.message; break; }
      uploadedPaths.push(path);
      photoRows.push({ listing_id: listingId, owner_id: user.id, storage_path: path, sort_order: (editingListing?.photoPaths?.length || 0) + index });
    }
    if (!photoErrorMessage && photoRows.length) {
      const { error: insertPhotosError } = await supabase.from("listing_photos").insert(photoRows);
      photoErrorMessage = insertPhotosError?.message || null;
    }
    if (photoErrorMessage) {
      if (uploadedPaths.length) await supabase.storage.from("listing-photos").remove(uploadedPaths);
      if (!editingListing) await supabase.from("listings").delete().eq("id", listingId);
      setError(`The listing photo upload failed: ${photoErrorMessage}`);
      setBusy(false);
      return;
    }

    const removedPaths = editingListing?.photoPaths?.filter((path) => !keptPhotoPaths.includes(path)) || [];
    if (removedPaths.length) {
      const { error: removeRowsError } = await supabase.from("listing_photos").delete().eq("listing_id", listingId).in("storage_path", removedPaths);
      if (removeRowsError) {
        setError(`Your listing was saved, but an old photo could not be removed: ${removeRowsError.message}`);
      } else {
        const { error: removeFilesError } = await supabase.storage.from("listing-photos").remove(removedPaths);
        if (removeFilesError) setError(`Your listing was saved, but an old photo file could not be removed: ${removeFilesError.message}`);
      }
    }

    if (editingListing) {
      const finalPaths = [...keptPhotoPaths, ...uploadedPaths];
      setSelectedListing({
        ...editingListing, ...values, photoPaths: finalPaths,
        photos: finalPaths.map((path) => supabase.storage.from("listing-photos").getPublicUrl(path).data.publicUrl),
      });
    }
    closeCreateForm();
    await loadListings();
    setBusy(false);
  }

  async function claimListing(listing: Listing, navigateToReservations = true) {
    setBusy(true); setError("");
    const { error: claimError } = await supabase.rpc("claim_listing", { p_listing_id: listing.id });
    if (claimError) { setError(claimError.message); setBusy(false); return false; }
    await Promise.all([loadListings(), loadReservations()]);
    if (navigateToReservations) setTab("reservations");
    setBusy(false);
    return true;
  }

  async function cancelReservation(reservationId: string) {
    setBusy(true);
    const { error: cancelError } = await supabase.rpc("cancel_reservation", { p_reservation_id: reservationId });
    if (cancelError) setError(cancelError.message);
    else {
      await Promise.all([loadListings(), loadReservations()]);
      if (selectedReservation?.id === reservationId) { setSelectedReservation(null); setSelectedListing(null); }
    }
    setBusy(false);
  }

  async function requestClaimConfirmation(reservation: Reservation) {
    setBusy(true); setError("");
    const { error: requestError } = await supabase.rpc("request_claim_confirmation", { p_reservation_id: reservation.id });
    if (requestError) setError(requestError.message);
    else {
      const updated = await loadReservations();
      setSelectedReservation(updated.find((row) => row.id === reservation.id) || reservation);
      setConfirmClaimPrompt(false);
    }
    setBusy(false);
  }

  async function resolveClaimConfirmation(reservation: Reservation, confirmed: boolean) {
    setBusy(true); setError("");
    const { error: resolutionError } = await supabase.rpc("resolve_claim_confirmation", {
      p_reservation_id: reservation.id,
      p_confirmed: confirmed,
    });
    if (resolutionError) setError(resolutionError.message);
    else {
      await Promise.all([loadListings(), loadReservations(), loadNotifications()]);
      setSelectedReservation(null);
      setSelectedListing(null);
    }
    setBusy(false);
  }

  async function reserveSelectedListing() {
    if (!selectedListing || !selectedPickup || selectedListing.owner_id === user.id || selectedListing.status !== "available") return;
    const reserved = await claimListing(selectedListing, false);
    if (reserved) {
      setSelectedListing({ ...selectedListing, status: "reserved" });
    }
  }

  function showListingDetails(listing: Listing) {
    setSelectedReservation(null);
    setSelectedListing(listing);
    setSelectedPickup("");
    setGalleryIndex(0);
    setError("");
  }

  async function messageSelectedDonor() {
    if (!selectedListing || selectedListing.owner_id === user.id) return;
    const existing = conversations.find((item) => item.listing_id === selectedListing.id && item.interested_user_id === user.id);
    if (existing) { if (await openConversation(existing)) setSelectedListing(null); return; }
    const reservation = reservations.find((item) => item.listing_id === selectedListing.id && item.claimant_id === user.id && item.status === "pending");
    if (!reservation?.listing) return;
    if (await startConversation({ ...reservation, listing: { ...reservation.listing, owner_id: selectedListing.owner_id } })) setSelectedListing(null);
  }

  async function openConversation(selected: Conversation): Promise<boolean> {
    setError("");
    const { data, error: messageError } = await supabase.from("messages")
      .select("id,body,sender_id,created_at,read_at").eq("conversation_id", selected.id).order("created_at");
    if (messageError) { setError(`Couldn't open this conversation: ${messageError.message}`); return false; }
    const unreadIds = (data || []).filter((row) => row.sender_id !== user.id && !row.read_at).map((row) => row.id);
    let loadedMessages = (data || []) as Message[];
    if (unreadIds.length) {
      const readAt = new Date().toISOString();
      const { error: readError } = await supabase.from("messages").update({ read_at: readAt })
        .in("id", unreadIds).is("read_at", null);
      if (readError) setError(readError.message);
      else loadedMessages = loadedMessages.map((row) => unreadIds.includes(row.id) ? { ...row, read_at: readAt } : row);
    }
    setUnreadConversations((current) => ({ ...current, [selected.id]: false }));
    setConversation(selected); setMessages(loadedMessages); setTab("inbox");
    return true;
  }

  function returnToInboxList() {
    setConversation(null);
    setMessages([]);
    setMessageText("");
    setTab("inbox");
    void loadConversations();
  }

  async function startConversation(reservation: Reservation): Promise<boolean> {
    const donorId = reservation.listing?.owner_id || reservation.donor_id;
    if (!reservation.listing_id || !donorId) { setError("Couldn't start this chat because the reservation has no donor or listing linked to it."); return false; }
    const { data: existing, error: lookupError } = await supabase.from("conversations")
      .select("id,listing_id,owner_id,interested_user_id").eq("listing_id", reservation.listing_id)
      .eq("interested_user_id", user.id).maybeSingle();
    if (lookupError) { setError(`Couldn't check for an existing chat: ${lookupError.message}`); return false; }
    if (existing) return openConversation(existing as Conversation);
    const { data, error: createError } = await supabase.from("conversations").insert({
      listing_id: reservation.listing_id, owner_id: donorId, interested_user_id: user.id,
    }).select("id,listing_id,owner_id,interested_user_id").single();
    if (createError) { setError(`Couldn't create the chat: ${createError.message}`); return false; }
    await loadConversations();
    return openConversation(data as Conversation);
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!conversation || !messageText.trim()) return;
    const { data, error: messageError } = await supabase.from("messages")
      .insert({ conversation_id: conversation.id, sender_id: user.id, body: messageText.trim() })
      .select("id,body,sender_id,created_at,read_at").single();
    if (messageError) setError(messageError.message);
    else { setMessages((current) => [...current, data as Message]); setMessageText(""); }
  }

  async function signOut() { await supabase.auth.signOut(); router.push("/"); router.refresh(); }

  function openCreateForm() {
    setEditingListing(null);
    setNewListing(emptyListing);
    setKeptPhotoPaths([]);
    setImageFiles([]);
    setImagePreviews([]);
    setShowCreate(true);
  }

  function openEditListing(listing: Listing) {
    setEditingListing(listing);
    setNewListing({
      title: listing.title,
      description: listing.description,
      category: listing.category,
      condition: listing.condition,
      listingType: listing.listing_type,
      price: listing.asking_price_cents === null ? "" : (listing.asking_price_cents / 100).toFixed(2),
      pickupArea: listing.pickup_area,
    });
    setKeptPhotoPaths(listing.photoPaths || []);
    setImageFiles([]);
    setImagePreviews([]);
    setError("");
    setShowCreate(true);
  }

  function toggleValue(values: string[], value: string, setter: (next: string[]) => void) {
    setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  function selectImages(files: FileList | null) {
    const selected = Array.from(files || []);
    if (selected.length + (editingListing ? keptPhotoPaths.length : 0) > 8) { setImageFiles([]); setImagePreviews([]); setError("You can upload up to 8 photos for one item."); return; }
    if (selected.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024)) {
      setImageFiles([]); setImagePreviews([]);
      setError("Each photo must be a JPG, PNG, or WebP image under 5 MB.");
      return;
    }
    setError("");
    setImageFiles(selected);
    setImagePreviews(selected.map((file) => URL.createObjectURL(file)));
  }

  function closeCreateForm() {
    setShowCreate(false);
    setEditingListing(null);
    setKeptPhotoPaths([]);
    setImageFiles([]);
    setImagePreviews([]);
    setNewListing(emptyListing);
  }

  return (
    <main className={selectedListing ? "marketplace-page detail-mode" : conversation ? "marketplace-page chat-mode" : "marketplace-page"}>
      <div className="marketplace-shell">
        {!selectedListing && <header className="market-home-header">
          <div><span>{institution}</span><h1>Hi, {name.split(" ")[0]}</h1></div>
          <button className="market-avatar" aria-label="Open profile" onClick={() => { setProfileScreen("account"); setTab("profile"); }}>{profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : initials}</button>
        </header>}

        {error && <p className="market-error" role="alert">{error}</p>}

        {reportingListing ? <section className="report-page">
          <header className="report-page-header"><button type="button" onClick={() => { setReportingListing(null); setReportSubmitted(false); setReportReason(""); setReportDetails(""); }}><ArrowLeft /> Cancel</button><h1>Report listing</h1>{reportSubmitted ? <span /> : <button type="submit" form="listing-report-form" disabled={busy || !reportReason}>{busy ? "Sending…" : "Submit"}</button>}</header>
          {reportSubmitted ? <div className="report-success"><div className="report-success-mark">✓</div><h2>Report received</h2><p>Thank you for helping keep the campus marketplace safe. The donor won’t be told who submitted this report.</p><button className="primary-button" onClick={() => { setReportingListing(null); setSelectedListing(null); setReportSubmitted(false); setReportReason(""); setReportDetails(""); }}>Back to Browse</button></div> : <>
            <div className="report-listing-summary"><span>● Reporting listing</span><strong>{reportingListing.title}</strong><small>Listed by {reportingListing.owner_name || "Campus student"} · {reportingListing.pickup_area}</small></div>
            <form id="listing-report-form" className="report-form" onSubmit={submitListingReport}><h2>Why are you reporting this listing?</h2>
              <div className="report-reasons">{REPORT_REASONS.map((reason) => <label key={reason.id} className={reportReason === reason.id ? "report-reason selected" : "report-reason"}><input type="radio" name="report-reason" value={reason.id} checked={reportReason === reason.id} onChange={() => setReportReason(reason.id)} required /><span><strong>{reason.label}</strong><small>{reason.hint}</small></span></label>)}</div>
              <label className="report-details-label">Additional information <em>Optional</em><textarea maxLength={1000} value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} placeholder="Share details that may help our review." /></label>
            </form>
          </>}
        </section> : selectedListing ? <section className="item-detail-page">
          <button className="detail-back-button" onClick={() => { setSelectedListing(null); setSelectedReservation(null); }} aria-label="Back to listings"><ArrowLeft /></button>
          <div className="detail-gallery" onScroll={(event) => { const width = event.currentTarget.clientWidth || 1; setGalleryIndex(Math.round(event.currentTarget.scrollLeft / width)); }}>
            {selectedListing.photos?.length ? selectedListing.photos.map((src, index) => <img key={src} src={src} alt={`${selectedListing.title}, photo ${index + 1}`} />) : <div className="detail-image-placeholder"><i /><b /><span /></div>}
          </div>
          {selectedListing.photos && selectedListing.photos.length > 1 && <div className="gallery-dots">{selectedListing.photos.map((src, index) => <span key={src} className={index === galleryIndex ? "active" : ""} />)}</div>}
          <div className="detail-content">
            <div className="detail-title-row"><div><h1>{selectedListing.title}{selectedListing.condition === "like_new" ? " — like new" : ""}</h1><p>{selectedListing.pickup_area} · Posted {formatPostedAt(selectedListing.created_at)}</p></div><div className="detail-side-actions"><span className="detail-price">{selectedListing.listing_type === "free" ? "Free" : `$${((selectedListing.asking_price_cents || 0) / 100).toFixed(2)}`}</span>{selectedListing.owner_id !== user.id && (!selectedReservation || (reservationDetailMode === "receiver" && selectedReservation.status === "pending")) && <button className="report-listing-button" aria-label="Report this listing" onClick={() => { setReportingListing(selectedListing); setReportReason(""); setReportDetails(""); setReportSubmitted(false); }}><FlagIcon /> Report</button>}</div></div>
            <div className="detail-tags"><span>{selectedListing.condition.replace("_", " ")}</span><span>{selectedListing.category}</span><span>{selectedReservation ? selectedReservation.status === "completed" ? "Claimed" : selectedReservation.status === "expired" ? "Expired" : selectedReservation.status === "cancelled" ? "Cancelled" : "Pending" : selectedListing.status === "reserved" ? "Reserved" : "Available"}</span></div>
            {selectedReservation && <div className="reservation-detail-meta">
              <h2>Reservation details</h2>
              <p><strong>Reserved:</strong> {new Date(selectedReservation.created_at).toLocaleString()}</p>
              <p><strong>Pickup:</strong> {selectedReservation.pickup_area_snapshot || selectedListing.pickup_area}</p>
              {selectedReservation.claimant_id === user.id && selectedReservation.status === "completed" && selectedReservation.claim_requested_at && <p><strong>Claimed:</strong> {new Date(selectedReservation.claim_requested_at).toLocaleString()}</p>}
              {selectedReservation.status === "pending" && <p className="hold-expiration"><strong>Hold expires:</strong> {new Date(selectedReservation.expires_at).toLocaleString()}</p>}
              {selectedReservation.claimant_id === user.id && selectedReservation.claim_confirmation_status === "awaiting_donor" && <p className="claim-waiting-note">We’ll contact the donor to confirm the handoff. This reservation stays pending until they respond.</p>}
              {selectedReservation.resolution_reason === "listing_deleted" && <p>This listing was removed by its donor. Reservation details are kept here for your records.</p>}
              {reservationDetailMode === "donor" && <p><strong>Receiver:</strong> {selectedReservation.claimant_name || "Campus student"}</p>}
            </div>}
            <h2>Description</h2><p className="detail-description">{selectedListing.description || "The donor did not add a description."}</p>
            <div className="donor-location-card"><div className="donor-avatar">{(selectedListing.owner_name || "S").slice(0, 1).toUpperCase()}</div><div><strong>{selectedListing.owner_id === user.id ? "You · donor" : selectedListing.owner_name || "Campus student"}</strong><span><LocationIcon /> Pickup at {selectedListing.pickup_area}</span></div>{selectedListing.owner_id !== user.id && <span className="verified-pill">Verified</span>}</div>
            {selectedListing.owner_id !== user.id && selectedListing.status === "available" && <label className="pickup-select-label">Choose pickup location<select required value={selectedPickup} onChange={(event) => setSelectedPickup(event.target.value)}><option value="">Select a pickup location</option><option value={selectedListing.pickup_area}>{selectedListing.pickup_area}</option></select></label>}
            {selectedReservation ? selectedReservation.claimant_id === user.id ? selectedReservation.status === "pending" ? <div className="detail-actions reservation-detail-actions"><button className="secondary-button detail-message-button" disabled={!selectedReservation.donor_id} onClick={async () => { if (await startConversation(selectedReservation)) { setSelectedReservation(null); setSelectedListing(null); } }}>Message donor</button><button className="outline-action cancel-reservation-button" disabled={busy} onClick={() => void cancelReservation(selectedReservation.id)}>Cancel reservation</button><button className="primary-button" disabled={busy || selectedReservation.claim_confirmation_status !== "not_requested"} onClick={() => setConfirmClaimPrompt(true)}>{selectedReservation.claim_confirmation_status === "awaiting_donor" ? "Waiting for donor" : "Item claimed"}</button></div> : null : reservationDetailMode === "donor" && selectedReservation.status === "pending" && selectedReservation.claim_confirmation_status === "awaiting_donor" ? <div className="detail-actions reservation-detail-actions"><button className="outline-action" disabled={busy} onClick={() => void resolveClaimConfirmation(selectedReservation, false)}>Not claimed</button><button className="primary-button" disabled={busy} onClick={() => void resolveClaimConfirmation(selectedReservation, true)}>Confirm item claimed</button></div> : null : selectedListing.owner_id === user.id ? <div className="detail-actions owner-listing-actions"><button className="secondary-button" onClick={() => openEditListing(selectedListing)}>Edit listing</button><button className="delete-listing-button" onClick={() => { setError(""); setDeleteListingPrompt(true); }}>Delete listing</button></div> : <div className="detail-actions"><button className="secondary-button detail-message-button" disabled={!(reservations.some((row) => row.listing_id === selectedListing.id && row.status === "pending") || conversations.some((row) => row.listing_id === selectedListing.id && row.interested_user_id === user.id))} onClick={() => void messageSelectedDonor()}>Message donor</button><button className="primary-button detail-reserve-button" disabled={selectedListing.status !== "available" || !selectedPickup || busy} onClick={() => void reserveSelectedListing()}>{selectedListing.status === "reserved" ? "Reserved" : "SwapRight"}</button></div>}
            {reservationDetailMode === "donor" && selectedReservation?.donor_id === user.id && selectedReservation.claim_confirmation_status === "confirmed" && <p className="claim-waiting-note claim-confirmed-note">Success! You and the receiver have both confirmed the item handoff.</p>}
          </div>
        </section> : tab === "browse" && <>
          <div className="search-row">
            <label className="search-box"><SearchIcon /><input value={query} onFocus={() => setSearchFocused(true)} onChange={(event) => setQuery(event.target.value)} placeholder="Search items near you" /></label>
            {searchFocused && <button className="open-filter-button" onClick={() => setShowFilters(true)}><FilterIcon /> Filters</button>}
          </div>
          <div className="quick-filters" aria-label="Quick listing filters">
            {[{ label: "All", value: "all" }, { label: "Free", value: "free" }, { label: "For sale", value: "for_sale" }, { label: "Furniture", value: "Furniture" }, { label: "Books", value: "Books" }].map((item) => {
              const active = item.value === "all" ? listingType === "all" && !categories.length : item.value === "free" || item.value === "for_sale" ? listingType === item.value : categories.includes(item.value);
              return <button key={item.value} className={active ? "quick-filter active" : "quick-filter"} onClick={() => {
                if (item.value === "all") { setListingType("all"); setCategories([]); }
                else if (item.value === "free" || item.value === "for_sale") setListingType(item.value);
                else toggleValue(categories, item.value, setCategories);
              }}>{item.label}</button>;
            })}
          </div>
          <div className="section-title"><h2>Available now</h2><span>{visibleListings.length} items</span></div>
          <section className={visibleListings.length ? "listing-grid" : "listing-grid listing-grid-empty"} aria-live="polite">
            {loading ? <div className="loading-state">Loading listings…</div> : visibleListings.length ? visibleListings.map((listing, index) => <article className="listing-card" key={listing.id}>
              <button className="listing-card-main" onClick={() => showListingDetails(listing)} aria-label={`View details for ${listing.title}`}><div className={`listing-image shade-${index % 5}`}>{listing.photos?.[0] && <img src={listing.photos[0]} alt="" /> }<span>{listing.listing_type === "free" ? "Free" : `$${((listing.asking_price_cents || 0) / 100).toFixed(0)}`}</span></div><h3>{listing.title}</h3><p className="listing-location">{listing.pickup_area} · {listing.category}</p></button>
              {listing.owner_id === user.id && <span className="your-listing-label">Your listing</span>}
            </article>) : <div className="empty-market"><div className="no-results-badge"><NoResultsIcon /></div><h2>{listings.length ? "No listings match these filters." : "No items available right now."}</h2><p>{listings.length ? "Try another search or clear some filters to see more items." : "Check back soon, or be the first to share something with your campus."}</p>{listings.length > 0 && <button className="empty-reset-button" onClick={() => { setQuery(""); setListingType("all"); setCategories([]); setConditions([]); setPrice("Any price"); }}>Clear search and filters</button>}</div>}
          </section>
        </>}

        {tab === "reservations" && !selectedListing && <section className="page-panel reservations-page" onTouchStart={(event) => setReservationTouchStart(event.touches[0].clientX)} onTouchEnd={(event) => swipeReservations(event.changedTouches[0].clientX)}><div className="section-title"><h2>My Reservations</h2><span>{receiverReservations.length}</span></div><div className="reservation-tabs" role="tablist" aria-label="Reservation status">{(["pending", "claimed", "cancelled"] as ReservationTab[]).map((status) => <button key={status} role="tab" aria-selected={reservationTab === status} className={reservationTab === status ? "active" : ""} onClick={() => setReservationTab(status)}>{status[0].toUpperCase() + status.slice(1)}<span>{reservationBuckets[status].length}</span></button>)}</div>{reservationBuckets[reservationTab].length ? <div className="listing-grid reservation-grid">{reservationBuckets[reservationTab].map((reservation, index) => { const item = reservation.listing!; const label = reservationTab === "pending" ? reservation.claim_confirmation_status === "awaiting_donor" ? "Awaiting donor" : "Pending" : reservationTab === "claimed" ? "Claimed" : reservation.status === "expired" ? "Expired" : "Cancelled"; return <article className="listing-card reservation-card" key={reservation.id}><button className="listing-card-main" onClick={() => void openReservationDetail(reservation, "receiver")} aria-label={`View reservation for ${item.title}`}><div className={`listing-image shade-${index % 5}`}>{item.photos?.[0] && <img src={item.photos[0]} alt="" />}<span>{item.listing_type === "free" ? "Free" : `$${((item.asking_price_cents || 0) / 100).toFixed(0)}`}</span></div><h3>{item.title}</h3><p className="listing-location">{item.pickup_area} · {item.category}</p><p className="reservation-card-time">Reserved {new Date(reservation.created_at).toLocaleDateString()}</p></button><div className="reservation-card-footer"><span className={`status-pill ${reservation.status}`}>{label}</span></div></article>; })}</div> : <div className="empty-market compact-empty"><h2>{reservationTab === "pending" ? "No pending reservations" : reservationTab === "claimed" ? "No claimed items yet" : "No cancelled reservations"}</h2><p>{reservationTab === "pending" ? "When you reserve an item, it will appear here." : reservationTab === "claimed" ? "Items confirmed by their donors will appear here." : "Cancelled or expired reservations will appear here."}</p>{reservationTab === "pending" && <button className="primary-button" onClick={() => setTab("browse")}>Browse items</button>}</div>}</section>}

        {tab === "inbox" && !selectedListing && <section className="page-panel inbox-page">
          {conversation ? <div className="chat-detail-screen" style={chatViewport ? { top: `${chatViewport.top}px`, height: `${chatViewport.height}px` } : undefined}>
            <header className="chat-detail-header"><button className="chat-back-button" onClick={returnToInboxList} aria-label="Back to Inbox"><ArrowLeft /></button><div><strong>{conversationLabels[conversation.id]?.listingTitle || "Reserved item"}</strong><span>{conversation.owner_id === user.id ? "Receiver" : "Donor"}: {conversationLabels[conversation.id]?.participantName || "Student"}</span></div></header>
            <div className="message-thread" ref={messageThreadRef} onScroll={(event) => { const element = event.currentTarget; chatWasAtBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48; }}>{messages.length ? messages.map((message) => <p className={`message ${message.sender_id === conversation.owner_id ? "donor" : "receiver"} ${message.sender_id === user.id ? "mine" : ""}`} key={message.id}>{message.body}</p>) : <p className="muted-copy">Start the conversation about pickup, condition, or price.</p>}</div>
            <form className="message-form" onSubmit={sendMessage}><input type="text" maxLength={4000} autoComplete="off" value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder="Write a message or emoji" /><button className="primary-button" type="submit">Send</button></form>
          </div> : <>
            <div className="section-title"><div><h2>Inbox</h2><span>Conversations about reserved items</span></div></div>
            <div className="conversation-list inbox-conversation-list">{conversations.length ? conversations.map((row) => { const label = conversationLabels[row.id]; const isDonor = row.owner_id === user.id; return <button className="conversation-item" key={row.id} onClick={() => void openConversation(row)}><span className="conversation-item-copy"><strong>{label?.listingTitle || "Reserved item"}</strong><small>{isDonor ? "Receiver" : "Donor"}: {label?.participantName || "Student"}</small></span>{unreadConversations[row.id] && <span className="unread-message-indicator" role="img" aria-label="Unread messages" title="Unread messages" />}</button>; }) : <div className="empty-market compact-empty"><h3>No conversations yet</h3><p>After you reserve an item, open its Pending reservation and choose Message donor to start a chat.</p></div>}</div>
          </>}
        </section>}

        {tab === "profile" && !selectedListing && <section className="page-panel profile-page">
          {profileScreen === "account" ? <>
            <h2 className="account-page-title">Account</h2>
            <div className="profile-card account-summary"><div className="profile-avatar">{profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : initials}</div><div className="account-summary-copy"><h2>{name}</h2><span className="verified-label">● Verified university student</span><p>{profile?.email || user.email} <small>Private · Read-only</small></p></div></div>
            <h3 className="settings-section-title">Preferences &amp; safety</h3>
            <div className="settings-card">
              <button className="account-tile" onClick={() => openProfileScreen("notifications")}><span className="tile-icon green"><BellIcon /></span><span className="tile-copy"><strong>Push notifications</strong><small>Alerts for reservations, messages, and reports</small></span><span className="tile-action">Open settings {notifications.filter((item) => !item.read_at).length > 0 && <b>{notifications.filter((item) => !item.read_at).length}</b>}</span></button>
              <button className="account-tile" onClick={() => openProfileScreen("blocked")}><span className="tile-icon gold"><UsersIcon /></span><span className="tile-copy"><strong>Blocked users</strong><small>Restricted from messaging and holds</small></span><span className="tile-action">{blockedPeople.length} students</span></button>
            </div>
            <h3 className="settings-section-title">Student pilot &amp; support</h3>
            <div className="settings-card">
              <button className="account-tile" onClick={() => openProfileScreen("guidelines")}><span className="tile-icon lavender"><ShieldCheckIcon /></span><span className="tile-copy"><strong>Community guidelines &amp; safe handoffs</strong><small>Lobby meetup rules &amp; scam safeguards</small></span><ChevronRightIcon /></button>
              <button className="account-tile" onClick={() => openProfileScreen("privacy")}><span className="tile-icon green"><LockIcon /></span><span className="tile-copy"><strong>Privacy &amp; data retention</strong><small>Rules for exchange records, reports, and account data</small></span><ChevronRightIcon /></button>
              <button className="account-tile" onClick={() => openProfileScreen("support")}><span className="tile-icon mint"><HelpIcon /></span><span className="tile-copy"><strong>Campus pilot support</strong><small>Pilot student support inbox<br />(support@swaprightapp.com)</small></span><ChevronRightIcon /></button>
            </div>
            <h3 className="settings-section-title">Account actions</h3>
            <div className="settings-card account-actions-card"><button className="account-action" onClick={() => setSignOutPrompt(true)}>Sign out <ChevronRightIcon /></button><button className="account-action destructive" onClick={() => { setDeleteConfirmation(""); setDeleteAccountPrompt(true); }}>Delete account <span className="destructive-action-icon"><TrashIcon /></span></button></div>
          </> : <>
            <header className="profile-subpage-header"><button onClick={() => openProfileScreen("account")} aria-label="Back to account"><ArrowLeft /></button><h2>{profileScreen === "notifications" ? "Push notifications" : profileScreen === "blocked" ? "Blocked users" : profileScreen === "guidelines" ? "Community guidelines" : profileScreen === "privacy" ? "Privacy & data retention" : "Campus pilot support"}</h2></header>
            {profileScreen === "notifications" && <>
              <p className="settings-intro">Choose which SwapRight activity should create an in-app notice. Browser alerts appear while the app is open and permission is enabled.</p>
              <div className="settings-card notification-preferences">
                <ToggleRow title="Reservations" description="When someone reserves one of your items. Claim checks always appear." checked={notificationPreferences.reservation_alerts} onChange={(checked) => void updateNotificationPreference("reservation_alerts", checked)} />
                <ToggleRow title="Messages" description="When a student sends you a chat message" checked={notificationPreferences.message_alerts} onChange={(checked) => void updateNotificationPreference("message_alerts", checked)} />
                <ToggleRow title="Safety reports" description="When a student reports one of your listings" checked={notificationPreferences.safety_alerts} onChange={(checked) => void updateNotificationPreference("safety_alerts", checked)} />
              </div>
              {browserPermission === "granted" ? <p className="permission-note success">Browser notifications are allowed on this device.</p> : <button className="outline-action" onClick={() => void allowBrowserNotifications()}>{browserPermission === "unsupported" ? "Browser alerts are unavailable" : "Allow browser notifications"}</button>}
              <div className="notification-heading"><h3>Recent activity</h3><button onClick={() => { void loadNotifications(); }}>Refresh</button></div>
              <div className="notification-list">{notifications.length ? notifications.map((item) => <button className={item.read_at ? "notification-card read" : "notification-card unread"} key={item.id} onClick={() => void openNotification(item)}><span className="notification-avatar">{item.avatar_url ? <img src={item.avatar_url} alt="" /> : item.notification_type === "reservation" ? (item.metadata.reservee_name || "S").slice(0, 1).toUpperCase() : item.notification_type === "listing_report" ? <FlagIcon /> : (item.metadata.sender_name || "S").slice(0, 1).toUpperCase()}</span><span className="notification-copy"><strong>{item.title}</strong><small>{item.body}</small>{item.notification_type === "listing_report" && <em>{item.metadata.warning || "Please recheck your listing photos, title, and description."}</em>}<time>{new Date(item.created_at).toLocaleString()}</time></span><span className="notification-dot" /></button>) : <div className="empty-settings"><BellIcon /><strong>No notifications yet</strong><span>Reservations, messages, and reports will appear here.</span></div>}</div>
            </>}
            {profileScreen === "blocked" && <><p className="settings-intro">Blocked students cannot message you or reserve your listings. You can unblock someone at any time.</p><div className="settings-card blocked-list">{blockedPeople.length ? blockedPeople.map((person) => <div className="blocked-row" key={person.id}><span className="blocked-avatar">{person.display_name.slice(0, 1).toUpperCase()}</span><span><strong>{person.display_name}</strong><small>Blocked {new Date(person.created_at).toLocaleDateString()}</small></span><button onClick={() => void unblockPerson(person)}>Unblock</button></div>) : <div className="empty-settings"><UsersIcon /><strong>No blocked students</strong><span>Students you block will be listed here.</span></div>}</div></>}
            {profileScreen === "guidelines" && <div className="information-panel"><p className="settings-intro">SwapRight is a student-to-student campus pilot. Keep exchanges respectful, clear, and in public campus spaces.</p><article><h3>List the real item</h3><p>Use current photos and an accurate title, condition, and price. Do not list prohibited items or items you do not own.</p></article><article><h3>Choose a safe handoff</h3><p>Meet in a well-lit public area, such as a staffed lobby. Tell someone you trust where you are going, and do not share passwords or financial account details.</p></article><article><h3>Keep communication in the app</h3><p>Use SwapRight messages to confirm item condition, pickup details, and any agreed price. Report suspicious behavior or listings.</p></article><button className="outline-action" onClick={() => { setSelectedListing(null); setTab("browse"); }}>Back to marketplace</button></div>}
            {profileScreen === "privacy" && <div className="information-panel"><p className="settings-intro">Your university email is private and is not shown on public listings. Only the profile details needed for campus exchanges are displayed.</p><article><h3>What the app stores</h3><p>Account and profile details, your listings and photos, reservations, chat messages, blocks, and safety reports.</p></article><article><h3>How long it is kept</h3><p>Your account, listings, chats, and your own reservations are removed when you delete your account. If another student has a reservation on one of your items, a de-identified reservation snapshot may remain in their history; photos attached to that reservation are retained for its history.</p></article><a className="outline-action mail-action" href="mailto:support@swaprightapp.com?subject=SwapRight%20privacy%20request">Ask about your data</a></div>}
            {profileScreen === "support" && <div className="information-panel"><div className="pilot-status"><span /> Student campus pilot</div><p className="settings-intro">Thanks for helping us test safer, simpler campus exchanges. Support can help with account access, reservations, reports, and listing problems.</p><article><h3>Before a handoff</h3><p>Confirm the item and pickup place in chat. Meet in a public campus location and do not send money outside an agreed sale.</p></article><article><h3>Need help?</h3><p>Email the SwapRight support team. Include the listing title and a short description of the issue; never include your password.</p></article><a className="primary-button support-email-button" href="mailto:support@swaprightapp.com?subject=SwapRight%20campus%20pilot%20support">Email support@swaprightapp.com</a><small className="support-address">Opens your system email app with the support address filled in.</small></div>}
          </>}
          {deleteAccountPrompt && <div className="modal-backdrop" role="presentation" onClick={() => setDeleteAccountPrompt(false)}><div className="delete-account-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-heading" onClick={(event) => event.stopPropagation()}><h2 id="delete-heading">Delete your account?</h2><p>This permanently deletes your profile, listings, messages, and your reservations. De-identified history may remain for students who had reserved your listings.</p><label>Type DELETE to confirm<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} /></label><div><button className="outline-action" onClick={() => setDeleteAccountPrompt(false)}>Cancel</button><button className="delete-confirm-button" disabled={deleteConfirmation !== "DELETE" || busy} onClick={() => void deleteAccount()}>{busy ? "Deleting…" : "Delete account"}</button></div></div></div>}
        </section>}

        {confirmClaimPrompt && selectedReservation && <div className="modal-backdrop" role="presentation" onClick={() => setConfirmClaimPrompt(false)}><div className="delete-account-dialog" role="dialog" aria-modal="true" aria-labelledby="claim-confirm-heading" onClick={(event) => event.stopPropagation()}><h2 id="claim-confirm-heading">Have you received this item?</h2><p>Confirm only after the handoff is complete. We’ll ask the donor to verify that you received it.</p><div><button className="outline-action" disabled={busy} onClick={() => setConfirmClaimPrompt(false)}>Not yet</button><button className="primary-button" disabled={busy} onClick={() => void requestClaimConfirmation(selectedReservation)}>I confirm</button></div></div></div>}

        {signOutPrompt && <div className="modal-backdrop" role="presentation" onClick={() => setSignOutPrompt(false)}><div className="delete-account-dialog" role="dialog" aria-modal="true" aria-labelledby="signout-heading" onClick={(event) => event.stopPropagation()}><h2 id="signout-heading">Sign out?</h2><p>You will need to sign back in to use your campus marketplace account.</p><div><button className="outline-action" onClick={() => setSignOutPrompt(false)}>Stay signed in</button><button className="primary-button" onClick={() => void signOut()}>Sign out</button></div></div></div>}

        {!selectedListing && !conversation && <nav className="bottom-nav" aria-label="Main navigation">
          <button className={tab === "browse" ? "nav-item active" : "nav-item"} onClick={() => { setSelectedListing(null); setTab("browse"); }}><BrowseIcon />Browse</button>
          <button className={tab === "reservations" ? "nav-item active" : "nav-item"} onClick={() => { setSelectedListing(null); setTab("reservations"); void loadReservations(); }}><ReservationIcon />My Reservations</button>
          <button className="nav-add" aria-label="Add a listing" onClick={openCreateForm}><PlusIcon /></button>
          <button className={tab === "inbox" ? "nav-item active" : "nav-item"} onClick={() => { setSelectedListing(null); setConversation(null); setMessages([]); setMessageText(""); setTab("inbox"); void loadConversations(); }}><InboxIcon />Inbox</button>
          <button className={tab === "profile" ? "nav-item active" : "nav-item"} onClick={() => { setSelectedListing(null); setProfileScreen("account"); setTab("profile"); void loadProfile(); }}><ProfileIcon />Profile</button>
        </nav>}
      </div>

      {showFilters && <div className="filter-backdrop" role="presentation" onClick={() => setShowFilters(false)}><section className="filter-sheet" role="dialog" aria-modal="true" aria-labelledby="filter-heading" onClick={(event) => event.stopPropagation()}>
        <div className="filter-handle" /><header><button onClick={() => setShowFilters(false)}>Cancel</button><h2 id="filter-heading">Filters</h2><button onClick={() => { setListingType("all"); setCategories([]); setConditions([]); setPrice("Any price"); }}>Reset</button></header>
        <FilterGroup title="Listing type">{[["All", "all"], ["Free only", "free"], ["For sale only", "for_sale"]].map(([label, value]) => <button key={value} className={`filter-chip ${listingType === value ? "selected" : ""}`} onClick={() => setListingType(value as "all" | ListingType)}>{label}</button>)}</FilterGroup>
        <FilterGroup title="Category">{CATEGORIES.map((category) => <button key={category} className={`filter-chip ${categories.includes(category) ? "selected" : ""}`} onClick={() => toggleValue(categories, category, setCategories)}>{category}</button>)}</FilterGroup>
        <FilterGroup title="Condition">{CONDITIONS.map((condition) => <button key={condition} className={`filter-chip ${conditions.includes(condition) ? "selected" : ""}`} onClick={() => toggleValue(conditions, condition, setConditions)}>{condition.replace("_", " ")}</button>)}</FilterGroup>
        <FilterGroup title="Price">{PRICE_OPTIONS.map((option) => <button key={option} className={`filter-chip ${price === option ? "selected" : ""}`} onClick={() => setPrice(option)}>{option}</button>)}</FilterGroup>
        <button className="primary-button filter-results" onClick={() => setShowFilters(false)}>Show {visibleListings.length} results</button>
      </section></div>}

      {showCreate && <div className="modal-backdrop" role="presentation" onClick={closeCreateForm}><form className="create-modal" onSubmit={publishListing} onClick={(event) => event.stopPropagation()}>
        <div className="modal-heading"><div><span className="eyebrow">{editingListing ? "Edit listing" : "New listing"}</span><h2>{editingListing ? "Update your item details." : "Give something a second life."}</h2></div><button type="button" onClick={closeCreateForm} aria-label="Close">×</button></div>
        <label>Title<input required minLength={3} value={newListing.title} onChange={(event) => setNewListing({ ...newListing, title: event.target.value })} /></label>
        <label>Description<textarea required minLength={8} value={newListing.description} onChange={(event) => setNewListing({ ...newListing, description: event.target.value })} /></label>
        <div className="form-two"><label>Category<select required value={newListing.category} onChange={(event) => setNewListing({ ...newListing, category: event.target.value })}><option value="" disabled>Choose a category</option>{CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></label><label>Condition<select required value={newListing.condition} onChange={(event) => setNewListing({ ...newListing, condition: event.target.value })}><option value="" disabled>Choose condition</option><option value="new">New</option><option value="like_new">Like new</option><option value="good">Good</option><option value="fair">Fair</option></select></label></div>
        <div className="form-two"><label>Listing type<select required value={newListing.listingType} onChange={(event) => setNewListing({ ...newListing, listingType: event.target.value as ListingType | "" })}><option value="" disabled>Choose listing type</option><option value="free">Free</option><option value="for_sale">For sale</option></select></label>{newListing.listingType === "for_sale" && <label>Asking price<input required type="number" min="0.01" step="0.01" value={newListing.price} onChange={(event) => setNewListing({ ...newListing, price: event.target.value })} /></label>}</div>
        <label>Pickup location<input required minLength={2} placeholder="e.g. Pine Hall 214" value={newListing.pickupArea} onChange={(event) => setNewListing({ ...newListing, pickupArea: event.target.value })} /></label>
        <label>{editingListing ? "Add or replace item photos" : "Item photos (upload at least one)"}<input required={!editingListing} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => selectImages(event.target.files)} /></label>
        {editingListing && keptPhotoPaths.length > 0 && <div className="photo-preview-grid">{(editingListing.photos || []).map((src, index) => {
          const path = editingListing.photoPaths?.[index];
          if (!path || !keptPhotoPaths.includes(path)) return null;
          return <div className="photo-preview-item" key={path}><img src={src} alt={`Current item photo ${index + 1}`} /><button type="button" onClick={() => setKeptPhotoPaths((current) => current.filter((item) => item !== path))}>Remove</button></div>;
        })}</div>}
        {imagePreviews.length > 0 && <div className="photo-preview-grid">{imagePreviews.map((src, index) => <img key={src} src={src} alt={`Selected item photo ${index + 1}`} />)}</div>}
        <button className="primary-button" type="submit" disabled={busy || !listingFormReady}>{busy ? "Saving…" : editingListing ? "Save changes" : "Publish listing"}</button>
      </form></div>}
      {deleteListingPrompt && selectedListing && <div className="modal-backdrop" role="presentation" onClick={() => setDeleteListingPrompt(false)}><div className="delete-account-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-listing-heading" onClick={(event) => event.stopPropagation()}><h2 id="delete-listing-heading">Delete this listing?</h2><p><strong>{selectedListing.title}</strong> will be removed, along with its photos and any active reservation. The student who reserved it will no longer see an active hold.</p><div><button className="outline-action" onClick={() => setDeleteListingPrompt(false)}>Keep listing</button><button className="delete-confirm-button" disabled={busy} onClick={() => void deleteListing()}>{busy ? "Deleting…" : "Delete listing"}</button></div></div></div>}
    </main>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return <div className="filter-group"><h3>{title}</h3><div>{children}</div></div>;
}

function ToggleRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="toggle-row"><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}

function formatPostedAt(timestamp: string) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (elapsedSeconds < 60) return "just now";
  if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)}m ago`;
  if (elapsedSeconds < 86400) return `${Math.floor(elapsedSeconds / 3600)}h ago`;
  if (elapsedSeconds < 86400 * 30) return `${Math.floor(elapsedSeconds / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
