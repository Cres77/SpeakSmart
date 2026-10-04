import Link from "next/link";

export function Logo({ onDark = false }: { onDark?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span
        className="grid h-7 w-7 place-items-center rounded-md text-[13px] font-semibold text-white"
        style={{ background: "linear-gradient(135deg, #533afd, #2bb6ff)" }}
      >
        S
      </span>
      <span className={`text-[18px] font-semibold tracking-tight ${onDark ? "text-white" : ""}`}>
        Speaksmart
      </span>
    </Link>
  );
}
