"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Check, PlusIcon, SearchIcon, ShieldIcon } from "@/components/icons";

type Listing = {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  listing_type: "free" | "for_sale";
  asking_price_cents: number | null;
  pickup_area: string;
  status: string;
  created_at: string;
  owner_name?: string;
};

type Reservation = { id: string; listing_id: string; status: string; expires_at: string; listing?: { title?: string; pickup_area?: string } };
type Conversation = { id: string; listing_id: string; owner_id: string; interested_user_id: string };
type Message = { id: string; body: string; sender_id: string; created_at: string };

const emptyListing = { title: "", description: "", category: "", condition: "good", listingType: "free" as "free" | "for_sale", price: "", pickupArea: "" };

export default function MarketplaceShell({ user }: { user: User }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<"browse" | "reservations" | "inbox">("browse");
  const [listings, setListings] = useState<Listing[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "free" | "for_sale">("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newListing, setNewListing] = useState(emptyListing);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState("");

  const name = user.user_metadata?.display_name || user.email?.split("@")[0] || "Student";
  const initials = name.split(/\s+/).map((part: string) => part[0]).slice(0, 2).join("").toUpperCase();

  async function loadListings() {
    setLoading(true);
    const { data, error: listingError } = await supabase.from("listings").select("id,owner_id,title,description,category,condition,listing_type,asking_price_cents,pickup_area,status,created_at").in("status", ["available", "reserved"]).order("created_at", { ascending: false });
    if (listingError) { setError(listingError.message); setLoading(false); return; }
    const rows = (data || []) as Listing[];
    const ownerIds = Array.from(new Set(rows.map((row) => row.owner_id)));
    const { data: profiles } = ownerIds.length ? await supabase.from("public_profiles").select("id,display_name").in("id", ownerIds) : { data: [] };
    const names = new Map((profiles || []).map((profile: { id: string; display_name: string }) => [profile.id, profile.display_name]));
    setListings(rows.map((row) => ({ ...row, owner_name: names.get(row.owner_id) || "Campus student" })));
    setLoading(false);
  }

  async function loadReservations() {
    const { data } = await supabase.from("reservations").select("id,listing_id,status,expires_at,listings(title,pickup_area)").eq("claimant_id", user.id).order("created_at", { ascending: false });
    setReservations((data || []) as Reservation[]);
  }

  useEffect(() => { void loadListings(); void loadReservations(); }, []);

  const visibleListings = listings.filter((listing) => {
    const haystack = `${listing.title} ${listing.description} ${listing.category}`.toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) && (filter === "all" || listing.listing_type === filter);
  });

  async function publishListing(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const price = newListing.listingType === "for_sale" ? Math.round(Number(newListing.price) * 100) : null;
    const { error: insertError } = await supabase.from("listings").insert({ owner_id: user.id, title: newListing.title.trim(), description: newListing.description.trim(), category: newListing.category.trim(), condition: newListing.condition, listing_type: newListing.listingType, asking_price_cents: price, pickup_area: newListing.pickupArea.trim() });
    if (insertError) setError(insertError.message); else { setShowCreate(false); setNewListing(emptyListing); await loadListings(); }
    setBusy(false);
  }

  async function claimListing(listing: Listing) {
    setBusy(true); setError("");
    const { error: claimError } = await supabase.rpc("claim_listing", { p_listing_id: listing.id });
    if (claimError) setError(claimError.message); else { await loadListings(); await loadReservations(); setTab("reservations"); }
    setBusy(false);
  }

  async function cancelReservation(reservationId: string) {
    setBusy(true);
    const { error: cancelError } = await supabase.rpc("cancel_reservation", { p_reservation_id: reservationId });
    if (cancelError) setError(cancelError.message); else { await loadListings(); await loadReservations(); }
    setBusy(false);
  }

  async function openConversation(listing: Listing) {
    setError("");
    let { data: existing } = await supabase.from("conversations").select("id,listing_id,owner_id,interested_user_id").eq("listing_id", listing.id).eq("interested_user_id", user.id).maybeSingle();
    if (!existing) {
      const result = await supabase.from("conversations").insert({ listing_id: listing.id, owner_id: listing.owner_id, interested_user_id: user.id }).select("id,listing_id,owner_id,interested_user_id").single();
      if (result.error) { setError(result.error.message); return; }
      existing = result.data;
    }
    setConversation(existing as Conversation);
    const { data: messageRows } = await supabase.from("messages").select("id,body,sender_id,created_at").eq("conversation_id", existing.id).order("created_at");
    setMessages((messageRows || []) as Message[]); setTab("inbox");
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!conversation || !messageText.trim()) return;
    const { data, error: messageError } = await supabase.from("messages").insert({ conversation_id: conversation.id, sender_id: user.id, body: messageText.trim() }).select("id,body,sender_id,created_at").single();
    if (messageError) setError(messageError.message); else { setMessages((current) => [...current, data as Message]); setMessageText(""); }
  }

  async function reportListing(listing: Listing) {
    const details = window.prompt("Tell us what is wrong with this listing. Reports are reviewed by the SwapRight team.");
    if (!details?.trim()) return;
    const { error: reportError } = await supabase.from("reports").insert({ reporter_id: user.id, target_type: "listing", listing_id: listing.id, reported_user_id: listing.owner_id, reason: "other", details: details.trim() });
    if (reportError) setError(reportError.message); else setError("Report submitted confidentially.");
  }

  async function blockUser(listing: Listing) {
    const { error: blockError } = await supabase.from("blocks").insert({ blocker_id: user.id, blocked_id: listing.owner_id });
    if (blockError) setError(blockError.message); else { setError("This student is blocked. Their listings will no longer be available to you."); await loadListings(); }
  }

  async function signOut() {
    setBusy(true); await supabase.auth.signOut(); router.push("/"); router.refresh();
  }

  return (
    <main className="marketplace-page">
      <div className="marketplace-shell">
        <header className="market-header"><div><span className="brand-mark">S</span><span className="brand-wordmark">SwapRight</span></div><button className="profile-chip" onClick={signOut} disabled={busy}><span>{initials}</span><b>{busy ? "Working…" : name}</b></button></header>
        <section className="market-hero"><div><p className="eyebrow"><ShieldIcon /> Verified U.S. university community</p><h1>Find something useful.<br /><em>Pass it forward.</em></h1><p>Browse affordable and free goods from students right on campus.</p></div><button className="primary-button list-button" onClick={() => setShowCreate(true)}><PlusIcon /> List an item</button></section>
        <nav className="market-tabs" aria-label="Marketplace sections"><button className={tab === "browse" ? "active" : ""} onClick={() => setTab("browse")}>Browse</button><button className={tab === "reservations" ? "active" : ""} onClick={() => { setTab("reservations"); void loadReservations(); }}>My reservations</button><button className={tab === "inbox" ? "active" : ""} onClick={() => setTab("inbox")}>Inbox</button></nav>
        {error && <p className="market-error" role="alert">{error}</p>}
        {tab === "browse" && <>
          <div className="browse-toolbar"><label className="search-box"><SearchIcon /><input placeholder="Search campus listings" value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className={filter === "all" ? "filter-button active" : "filter-button"} onClick={() => setFilter("all")}>All items</button><button className={filter === "free" ? "filter-button active" : "filter-button"} onClick={() => setFilter("free")}>Free</button><button className={filter === "for_sale" ? "filter-button active" : "filter-button"} onClick={() => setFilter("for_sale")}>For sale</button></div>
          <section className="listing-grid" aria-live="polite">{loading ? <div className="loading-state">Loading listings…</div> : visibleListings.length ? visibleListings.map((listing) => <article className="listing-card" key={listing.id}><div className="listing-image"><span>{listing.category.slice(0, 1).toUpperCase()}</span></div><div className="listing-card-body"><div className="listing-meta"><span>{listing.listing_type === "free" ? "Free" : `$${((listing.asking_price_cents || 0) / 100).toFixed(2)}`}</span><small>{listing.condition.replace("_", " ")}</small></div><h2>{listing.title}</h2><p>{listing.description || "No description provided."}</p><div className="listing-footer"><span>{listing.owner_name} · {listing.pickup_area}</span>{listing.owner_id === user.id ? <small>Your listing</small> : <button onClick={() => void claimListing(listing)} disabled={busy || listing.status !== "available"}>{listing.status === "reserved" ? "Reserved" : "Claim"}</button>}</div><div className="listing-actions"><button onClick={() => void openConversation(listing)}>Message</button><button onClick={() => void reportListing(listing)}>Report</button>{listing.owner_id !== user.id && <button onClick={() => void blockUser(listing)}>Block</button>}</div></div></article>) : <div className="empty-market"><div className="empty-icon"><Check /></div><h2>No listings match that search.</h2><p>Try another keyword or list the first item for your campus.</p></div>}</section>
        </>}
        {tab === "reservations" && <section className="panel-section"><h2>My reservations</h2>{reservations.length ? reservations.map((reservation) => <article className="reservation-row" key={reservation.id}><div><strong>{reservation.listing?.title || "Reserved listing"}</strong><span>{reservation.listing?.pickup_area || "Campus pickup"} · Expires {new Date(reservation.expires_at).toLocaleString()}</span></div><div><span className={`status-pill ${reservation.status}`}>{reservation.status}</span>{reservation.status === "pending" && <button className="text-action" onClick={() => void cancelReservation(reservation.id)}>Cancel</button>}</div></article>) : <div className="empty-market compact-empty"><h2>No active reservations.</h2><p>Claim an available item and it will appear here for 24 hours.</p></div>}</section>}
        {tab === "inbox" && <section className="panel-section inbox-panel"><h2>Private messages</h2>{conversation ? <><div className="message-thread">{messages.length ? messages.map((message) => <p className={message.sender_id === user.id ? "message mine" : "message"} key={message.id}>{message.body}</p>) : <p className="muted-copy">Start a private conversation about pickup, condition, or price.</p>}</div><form className="message-form" onSubmit={sendMessage}><input value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder="Write a message" /><button className="primary-button" type="submit">Send</button></form></> : <div className="empty-market compact-empty"><h2>Your inbox is private.</h2><p>Open a listing and choose Message to coordinate with another student.</p></div>}</section>}
        <footer className="market-footer"><span><Check /> Verified university email</span><button onClick={signOut}>Sign out</button></footer>
        {showCreate && <div className="modal-backdrop" role="presentation"><form className="create-modal" onSubmit={publishListing}><div className="modal-heading"><div><span className="eyebrow">New listing</span><h2>Give something a second life.</h2></div><button type="button" onClick={() => setShowCreate(false)} aria-label="Close">×</button></div><label>Title<input required minLength={3} value={newListing.title} onChange={(event) => setNewListing({ ...newListing, title: event.target.value })} /></label><label>Description<textarea value={newListing.description} onChange={(event) => setNewListing({ ...newListing, description: event.target.value })} /></label><div className="form-two"><label>Category<input required value={newListing.category} onChange={(event) => setNewListing({ ...newListing, category: event.target.value })} /></label><label>Condition<select value={newListing.condition} onChange={(event) => setNewListing({ ...newListing, condition: event.target.value })}><option value="new">New</option><option value="like_new">Like new</option><option value="good">Good</option><option value="fair">Fair</option></select></label></div><div className="form-two"><label>Type<select value={newListing.listingType} onChange={(event) => setNewListing({ ...newListing, listingType: event.target.value as "free" | "for_sale" })}><option value="free">Free</option><option value="for_sale">For sale</option></select></label>{newListing.listingType === "for_sale" && <label>Asking price<input required type="number" min="0" step="0.01" value={newListing.price} onChange={(event) => setNewListing({ ...newListing, price: event.target.value })} /></label>}</div><label>General pickup area<input required placeholder="e.g. Tiger Village" value={newListing.pickupArea} onChange={(event) => setNewListing({ ...newListing, pickupArea: event.target.value })} /></label><button className="primary-button" type="submit" disabled={busy}>{busy ? "Publishing…" : "Publish listing"}</button></form></div>}
      </div>
    </main>
  );
}
