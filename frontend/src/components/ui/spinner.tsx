import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/utils";

const spinnerVariants = cva("animate-spin rounded-full border-solid", {
  variants: {
    size: {
      small: "h-4 w-4 border-2",
      medium: "h-8 w-8 border-4",
      large: "h-12 w-12 border-4",
    },
    color: {
      primary: "border-primary border-t-transparent",
      white: "border-white border-t-transparent",
    },
  },
  defaultVariants: {
    size: "medium",
    color: "primary",
  },
});

interface SpinnerProps extends VariantProps<typeof spinnerVariants> {
  className?: string;
}

const Spinner = ({ size, color, className }: SpinnerProps) => {
  return (
    <div
      className={cn(spinnerVariants({ size, color }), className)}
      role="status"
      aria-label="Loading"
    />
  );
};

export { Spinner }; 