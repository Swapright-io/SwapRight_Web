import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AuthFlow from "@/components/auth-flow";

export default async function HomePage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    return <AuthFlow />;
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) redirect("/marketplace");

  return <AuthFlow />;
}
