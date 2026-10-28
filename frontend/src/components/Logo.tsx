import React from "react";
import Image from "next/image";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { VisuallyHidden } from "./ui/visually-hidden";
import { About } from "./About";

interface LogoProps {
  isCollapsed: boolean;
}

const Logo = React.forwardRef<HTMLButtonElement, LogoProps>(
  ({ isCollapsed }, ref) => {
    return (
      <Dialog aria-describedby={undefined}>
        <DialogTrigger asChild>
          <button
            ref={ref}
            type="button"
            className={`flex min-w-0 items-center gap-2.5 rounded-xl text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isCollapsed ? 'h-10 w-10 justify-center' : 'w-full p-1.5'}`}
            aria-label="关于 AiGoodMeeting"
          >
            <Image
              src="/aigoodbro-icon.png"
              alt="AiGoodMeeting"
              width={36}
              height={36}
              className="shrink-0 rounded-[10px] object-contain"
              priority
            />
            {!isCollapsed && (
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold tracking-tight text-foreground">AiGoodMeeting</span>
                <span className="block text-[11px] leading-4 text-muted-foreground">会议纪要</span>
              </span>
            )}
          </button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl border-border bg-card text-card-foreground">
          <VisuallyHidden>
            <DialogTitle>关于 AiGoodMeeting</DialogTitle>
          </VisuallyHidden>
          <About />
        </DialogContent>
      </Dialog>
    );
  },
);

Logo.displayName = "Logo";

export default Logo;
