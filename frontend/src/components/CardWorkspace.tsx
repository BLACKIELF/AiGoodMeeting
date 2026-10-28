'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export interface WorkspaceCard {
  id: string;
  title: string;
  description?: string;
  icon: LucideIcon;
  meta?: ReactNode;
  content: ReactNode;
}

interface CardWorkspaceProps {
  id: string;
  cards: WorkspaceCard[];
  value: string;
  onValueChange: (id: string) => void;
  className?: string;
}

export function CardWorkspace({ id, cards, value, onValueChange, className }: CardWorkspaceProps) {
  const instance = useId();
  const activeId = cards.some(card => card.id === value) ? value : cards[0]?.id;
  const [visited, setVisited] = useState(() => new Set(activeId ? [activeId] : []));
  const [keyboardInput, setKeyboardInput] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (activeId) setVisited(previous => previous.has(activeId) ? previous : new Set([...previous, activeId]));
  }, [activeId]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  if (!activeId) return null;

  return (
    <Tabs value={activeId} onValueChange={onValueChange} orientation="vertical"
      className={cn('agb-card-workspace', className)}
      onKeyDownCapture={() => setKeyboardInput(true)}
      onPointerDownCapture={() => setKeyboardInput(false)}
      data-workspace={id}
      data-motion={reducedMotion || keyboardInput ? 'reduced' : 'full'}>
      <div className="agb-card-layout">
        <TabsList className="agb-workspace-card-list" aria-label="选择展开的卡片">
          {cards.map(card => {
            const Icon = card.icon;
            const expanded = card.id === activeId;
            const descriptionId = `${id}-${instance}-${card.id}-description`;
            return (
              <TabsTrigger key={card.id} value={card.id} className="agb-card agb-workspace-card"
                aria-expanded={expanded}
                data-selected={expanded}
                aria-describedby={card.description ? descriptionId : undefined}
                onClick={() => { if (!expanded) onValueChange(card.id); }}>
                <span className="agb-workspace-card-top">
                  <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className="agb-workspace-card-title">{card.title}</span>
                  <ChevronRight className="agb-workspace-card-chevron h-4 w-4 shrink-0" aria-hidden="true" />
                </span>
                {card.description && <span className="agb-workspace-card-description" id={descriptionId}>{card.description}</span>}
                {card.meta && <span className="agb-workspace-card-meta">{card.meta}</span>}
              </TabsTrigger>
            );
          })}
        </TabsList>
        <div className="agb-card-content-column">
          {cards.map(card => {
            const active = card.id === activeId;
            return (
              <TabsContent key={card.id} value={card.id} forceMount hidden={!active}
                className="agb-panel agb-workspace-panel" {...(!active ? { inert: '' as unknown as boolean } : {})}>
                <motion.div className="agb-card-reveal" initial={false}
                  animate={{ opacity: active ? 1 : 0, transform: active || reducedMotion || keyboardInput ? 'translateY(0px)' : 'translateY(8px)' }}
                  transition={{ duration: keyboardInput ? 0 : reducedMotion ? 0.1 : 0.2, ease: [0.23, 1, 0.32, 1] }}>
                  {(active || visited.has(card.id)) && card.content}
                </motion.div>
              </TabsContent>
            );
          })}
        </div>
      </div>
    </Tabs>
  );
}
