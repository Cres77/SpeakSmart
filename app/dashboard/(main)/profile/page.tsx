import { auth } from "@/lib/auth/server";
import { ProfileForm } from "@/components/profile-form";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/login");

  return (
    <div className="h-full overflow-auto bg-white">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <h1 className="mb-6 text-3xl font-semibold tracking-tight">Profile</h1>
        <ProfileForm name={session.user.name ?? ""} email={session.user.email ?? ""} />
      </div>
    </div>
  );
}
