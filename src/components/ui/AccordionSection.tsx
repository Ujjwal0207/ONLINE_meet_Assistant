import React from 'react';
import { ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface DisclosureChevronProps {
  open: boolean;
  className?: string;
}

export const DisclosureChevron: React.FC<DisclosureChevronProps> = ({ open, className = '' }) => {
  return (
    <ChevronRight
      size={14}
      className={`transition-transform duration-200 ${open ? 'rotate-90' : 'rotate-0'} ${className}`}
    />
  );
};

export interface DisclosureProps {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}

export const Disclosure: React.FC<DisclosureProps> = ({ open, children, className = '' }) => {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className={`overflow-hidden ${className}`}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export interface AccordionSectionProps {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export const AccordionSection: React.FC<AccordionSectionProps> = ({
  title,
  icon,
  children,
  defaultOpen = false,
}) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  return (
    <div className="border rounded-xl mb-4 overflow-hidden transition-all duration-200 bg-bg-card border-border-subtle shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between p-4 transition-colors hover:bg-bg-item-surface group"
      >
        <div className="flex items-center gap-3">
          {icon && (
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-bg-item-surface border border-border-subtle group-hover:border-border-muted transition-colors text-text-secondary">
              {icon}
            </div>
          )}
          <span className="font-semibold text-sm text-text-primary">{title}</span>
        </div>
        <DisclosureChevron open={isOpen} />
      </button>
      <Disclosure open={isOpen}>
        <div className="p-5 border-t border-border-subtle text-sm leading-relaxed text-text-secondary">
          {children}
        </div>
      </Disclosure>
    </div>
  );
};

export default AccordionSection;
