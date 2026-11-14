'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { motion, type Transition } from 'framer-motion';
import { ChevronDown, type LucideIcon } from 'lucide-react';
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
  layout?: 'drawers' | 'overview';
}

const drawerSpring: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 36,
  mass: 0.88,
};

interface ExpandableCardItemProps {
  card: WorkspaceCard;
  index: number;
  expanded: boolean;
  hasSelection: boolean;
  visited: boolean;
  triggerId: string;
  panelId: string;
  descriptionId: string;
  motionTransition: Transition;
  reducedMotion: boolean;
  keyboardInput: boolean;
  onToggle: () => void;
}

function ExpandableCardItem({
  card,
  index,
  expanded,
  hasSelection,
  visited,
  triggerId,
  panelId,
  descriptionId,
  motionTransition,
  reducedMotion,
  keyboardInput,
  onToggle,
}: ExpandableCardItemProps) {
  const Icon = card.icon;
  const [isVisible, setIsVisible] = useState(expanded);

  useEffect(() => {
    if (expanded) {
      setIsVisible(true);
    } else if (keyboardInput || reducedMotion) {
      setIsVisible(false);
    }
  }, [expanded, keyboardInput, reducedMotion]);

  const handleAnimationComplete = () => {
    if (!expanded) {
      setIsVisible(false);
    }
  };

  const isBlock = expanded || isVisible;
  const isSpine = hasSelection && !expanded;
  const indexLabel = String(index + 1).padStart(2, '0');

  return (
    <div
      className="agb-card agb-expandable-card"
      data-card-id={card.id}
      data-expanded={expanded}
      data-selected={expanded}
      data-spine={isSpine}
    >
      <button
        type="button"
        id={triggerId}
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-describedby={card.description ? descriptionId : undefined}
        title={isSpine ? `${card.title}${card.description ? ` · ${card.description}` : ''}` : undefined}
        className="agb-card-trigger"
        onClick={onToggle}
      >
        <span className="agb-card-trigger-left">
          <span className="agb-card-index" data-index={indexLabel} aria-hidden="true" />
          <span
            className={cn(
              'agb-card-icon-badge',
              expanded ? 'bg-primary/15 text-primary' : 'bg-muted/70 text-muted-foreground'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          </span>
          <span className="agb-card-trigger-text">
            <span className="agb-card-title">{card.title}</span>
            {card.description && (
              <span className="agb-card-description" id={descriptionId}>
                {card.description}
              </span>
            )}
          </span>
        </span>
        <span className="agb-card-trigger-right">
          {card.meta && (
            <span className="agb-card-meta" data-has-meta="true">
              <span className="agb-card-meta-dot" aria-hidden="true" />
              <span className="agb-card-meta-text">{card.meta}</span>
            </span>
          )}
          <ChevronDown
            className={cn(
              'agb-card-chevron h-4 w-4 shrink-0 transition-transform duration-300 motion-reduce:transition-none',
              expanded ? 'rotate-180 text-primary' : 'rotate-0 text-muted-foreground'
            )}
            aria-hidden="true"
          />
        </span>
      </button>

      <motion.div
        id={panelId}
        role="region"
        aria-labelledby={triggerId}
        aria-hidden={!expanded}
        hidden={!isBlock}
        {...(!expanded ? { inert: '' as unknown as boolean } : {})}
        className="agb-card-body"
        initial={false}
        animate={{
          opacity: expanded ? 1 : 0,
          transform:
            expanded || reducedMotion || keyboardInput
              ? 'translateY(0px)'
              : 'translateX(10px)',
        }}
        transition={motionTransition}
        style={{
          overflow: 'hidden',
          display: isBlock ? 'block' : 'none',
        }}
        onAnimationComplete={handleAnimationComplete}
      >
        <div className="agb-card-body-inner custom-scrollbar">
          {(expanded || visited) && card.content}
        </div>
      </motion.div>
    </div>
  );
}

export function CardWorkspace({ id, cards, value, onValueChange, className, layout = 'drawers' }: CardWorkspaceProps) {
  const instance = useId();
  const activeId = cards.some(card => card.id === value) ? value : value === '' ? '' : cards[0]?.id;
  const hasSelection = Boolean(activeId);
  const [visited, setVisited] = useState(() => new Set(activeId ? [activeId] : []));
  const [keyboardInput, setKeyboardInput] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (activeId) {
      setVisited(previous => (previous.has(activeId) ? previous : new Set([...previous, activeId])));
    }
  }, [activeId]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const motionTransition: Transition = keyboardInput
    ? { duration: 0 }
    : reducedMotion
      ? { duration: 0.08, ease: 'easeOut' }
      : drawerSpring;

  return (
    <div
      className={cn('agb-card-workspace custom-scrollbar', className)}
      onKeyDownCapture={() => setKeyboardInput(true)}
      onPointerDownCapture={() => setKeyboardInput(false)}
      data-workspace={id}
      data-layout={layout === 'overview' ? 'overview' : 'archive-drawers'}
      data-motion={reducedMotion || keyboardInput ? 'reduced' : 'full'}
    >
      <div
        className="agb-card-stack"
        role="region"
        aria-label="卡片工作区"
        data-has-selection={hasSelection}
        data-dense={layout === 'drawers' ? cards.length >= 5 : undefined}
      >
        {cards.map((card, index) => {
          const expanded = card.id === activeId;
          const triggerId = `${id}-${instance}-${card.id}-trigger`;
          const panelId = `${id}-${instance}-${card.id}-panel`;
          const descriptionId = `${id}-${instance}-${card.id}-description`;

          return (
            <ExpandableCardItem
              key={card.id}
              card={card}
              index={index}
              expanded={expanded}
              hasSelection={layout === 'drawers' && hasSelection}
              visited={visited.has(card.id)}
              triggerId={triggerId}
              panelId={panelId}
              descriptionId={descriptionId}
              motionTransition={motionTransition}
              reducedMotion={reducedMotion}
              keyboardInput={keyboardInput}
              onToggle={() => onValueChange(expanded ? '' : card.id)}
            />
          );
        })}
      </div>
    </div>
  );
}
