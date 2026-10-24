import type { HTMLAttributes, ReactNode } from "react";

export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  variant?: "node" | "feed" | "inset" | "callout";
  statusTone?: "sealed" | "revealable" | "revealed" | "lapsed";
  title?: ReactNode;
}

/**
 * Timeline entry container for predictions, chronological nodes, and verdicts.
 */
export default function Panel({
  variant = "node",
  statusTone,
  title,
  children,
  className = "",
  style,
  ...rest
}: PanelProps) {
  let variantStyle = "bg-[#143644] border border-[#24505F]";
  if (variant === "feed") {
    variantStyle = "bg-[#143644] border border-[#24505F] hover:border-[#F2B880]/60 transition-colors";
  } else if (variant === "inset") {
    variantStyle = "bg-[#1B4556] border border-[#24505F]/60";
  } else if (variant === "callout") {
    variantStyle = "bg-[#1B4556] border-l-2 border-[#F2B880] text-[#D9ECF2]";
  }

  let toneStyle = "";
  if (statusTone === "revealed") {
    toneStyle = "border-l-2 border-l-[#7BD3A1]";
  } else if (statusTone === "revealable") {
    toneStyle = "border-l-2 border-l-[#F2B880]";
  } else if (statusTone === "lapsed") {
    toneStyle = "opacity-80 border-l-2 border-l-[#658592]";
  }

  return (
    <div
      className={`hindsight-timeline-entry relative p-4 sm:p-5 rounded-[2px] ${variantStyle} ${toneStyle} ${className}`}
      style={style}
      {...rest}
    >
      {title && (
        <div className="mb-2.5 pb-1 border-b border-[#24505F]/70 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8FB0BC]">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}
