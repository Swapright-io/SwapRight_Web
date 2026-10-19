import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MarketplaceShell from "@/components/marketplace-shell";

export default async function MarketplacePage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    redirect("/");
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/");

  return <MarketplaceShell user={user} />;
}
