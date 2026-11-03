import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
}

/** 高さ 48px 以上（theme.css の --tap）。form を誤って送らないよう type は button が既定 */
export function Button({ variant = "secondary", className, type = "button", ...rest }: ButtonProps) {
  const cls = ["btn", variant === "primary" ? "btn-primary" : "", className ?? ""].filter(Boolean).join(" ");
  return <button type={type} className={cls} {...rest} />;
}
