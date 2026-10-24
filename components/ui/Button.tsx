"use client";

import { type ButtonHTMLAttributes, forwardRef } from "react";

export type ButtonVariant = "primary" | "secondary" | "right" | "wrong" | "ghost";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-[#F2B880] text-[#0E2A35] hover:bg-[#E4AB75] border border-transparent font-semibold shadow-sm active:translate-y-px",
  secondary:
    "bg-[#1B4556] text-[#D9ECF2] hover:bg-[#235569] border border-[#31687B] active:translate-y-px",
  right:
    "bg-[#7BD3A1]/15 text-[#7BD3A1] hover:bg-[#7BD3A1]/25 border border-[#7BD3A1]/50 font-medium active:translate-y-px",
  wrong:
    "bg-[#F28B82]/15 text-[#F28B82] hover:bg-[#F28B82]/25 border border-[#F28B82]/50 font-medium active:translate-y-px",
  ghost:
    "bg-transparent text-[#8FB0BC] hover:text-[#D9ECF2] hover:bg-[#143644] border border-transparent",
};

const sizeStyles: Record<ButtonSize, string> = {
  xs: "px-2.5 py-0.5 text-[11px]",
  sm: "px-3.5 py-1.5 text-[12px]",
  md: "px-4.5 py-2 text-[13px]",
  lg: "px-5.5 py-2.5 text-[14px]",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      disabled = false,
      children,
      className = "",
      ...rest
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={[
          "timeline-action-button inline-flex items-center justify-center gap-2",
          "tracking-[0.015em] transition-all duration-150",
          "cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed rounded-[2px]",
          sizeStyles[size],
          variantStyles[variant],
          className,
        ].join(" ")}
        {...rest}
      >
        {loading && (
          <span
            className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"
            aria-hidden="true"
          />
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
export default Button;
