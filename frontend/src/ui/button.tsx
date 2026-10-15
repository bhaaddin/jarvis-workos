// shadcn/ui button (MIT, new-york pattern, Tailwind v4, no forwardRef):
// cva variants + Radix Slot + lib cn. Variant names keep the Jarvis API
// (primary/secondary/ghost/danger) so existing screens upgrade untouched.
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary",
        secondary:
          "border border-border bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/70",
        ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
        danger:
          "border border-destructive/50 bg-destructive/15 text-destructive shadow-xs hover:bg-destructive/25",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "secondary", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
