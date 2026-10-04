import { redirect } from "next/navigation";

export default function NewSessionPage() {
  redirect("/dashboard?new=1");
}
