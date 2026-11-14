"use client";

import { forwardRef, useEffect, useId, useRef, useState } from "react";
import type { ComponentPropsWithoutRef } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./select.module.css";

export interface SelectProps extends Omit<ComponentPropsWithoutRef<typeof SelectPrimitive.Root>, "children"> {
  label: string;
  description?: string;
  placeholder?: string;
  id?: string;
  className?: string;
  options: { value: string; label: string; disabled?: boolean }[];
  /** Marks the trigger invalid so the surrounding field can announce it. */
  invalid?: boolean;
  /** Ids of hints or errors that describe the trigger. */
  describedBy?: string;
  /** Portal target for the menu. Documents theme their variables on the document root. */
  portalContainer?: HTMLElement | null;
}

/** The shown value rolls in the direction of the list: a later option rises from below, an earlier one drops from above. */
const valueRoll: Variants = {
  enter: (direction: number) => ({ opacity: 0, y: `${direction * 0.35}em`, filter: `blur(${motionTokens.blur.soft}px)` }),
  center: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] } },
  exit: (direction: number) => ({ opacity: 0, y: `${direction * -0.3}em`, filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } }),
};
/** Reduced motion keeps a short crossfade; the resting state matches valueRoll so server and client markup agree. */
const valueFade: Variants = { enter: { opacity: 0 }, center: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: motionTokens.duration.instant } }, exit: { opacity: 0, transition: { duration: motionTokens.duration.instant } } };

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { label, description, placeholder = "Select an option", options, id, className, disabled, invalid, describedBy, portalContainer, onValueChange, open: controlledOpen, defaultOpen, onOpenChange, ...rootProps },
  ref,
) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = description ? `${controlId}-description` : undefined;
  const described = [hintId, describedBy].filter(Boolean).join(" ") || undefined;
  // A menu rendered in the page body would lose the document's theme variables,
  // so it mounts inside the nearest themed root unless the host names a target.
  // A callback ref re-renders once the field is in the document.
  const [field, setField] = useState<HTMLDivElement | null>(null);
  const container = portalContainer
    ?? field?.closest<HTMLElement>(".local-select")
    ?? field?.closest<HTMLElement>("[data-rmd-theme]")
    ?? undefined;
  const reduceMotion = useReducedMotion();
  const [uncontrolledValue, setUncontrolledValue] = useState(rootProps.defaultValue ?? "");
  const currentValue = rootProps.value ?? uncontrolledValue;
  const [open, setOpen] = useState(defaultOpen ?? false);
  const previousValue = useRef(currentValue);
  useEffect(() => {
    if (disabled || previousValue.current !== currentValue) setOpen(false);
    previousValue.current = currentValue;
  }, [currentValue, disabled]);
  const index = options.findIndex((option) => option.value === currentValue);
  const shown = currentValue ? options[index]?.label ?? "" : placeholder;
  const [previousIndex, setPreviousIndex] = useState(index);
  const [direction, setDirection] = useState(1);
  if (previousIndex !== index) { setPreviousIndex(index); setDirection(index > previousIndex ? 1 : -1); }

  return (
    <div className={styles.field} ref={setField} data-rmd-component="select" data-rmd-part="field">
      <label htmlFor={controlId} data-rmd-part="label">{label}</label>
      <SelectPrimitive.Root {...rootProps} disabled={disabled} open={!disabled && (controlledOpen ?? open)} onOpenChange={(next) => { setOpen(next); onOpenChange?.(next); }} onValueChange={(next) => { setUncontrolledValue(next); onValueChange?.(next); }}>
        <SelectPrimitive.Trigger
          ref={ref}
          id={controlId}
          aria-describedby={described}
          aria-invalid={invalid || undefined}
          data-rmd-part="trigger"
          className={[styles.trigger, className].filter(Boolean).join(" ")}
        >
          {/* Radix keeps the real value for assistive tech; the visible copy below animates between values. It gets the label up front so server markup names the current option without waiting for the menu to mount. */}
          <span className={styles.srOnly}><SelectPrimitive.Value placeholder={placeholder}>{currentValue ? shown : undefined}</SelectPrimitive.Value></span>
          <span className={styles.valueText} data-rmd-part="value" aria-hidden="true">
            <AnimatePresence initial={false} custom={direction}>
              <motion.span key={currentValue ? `value-${currentValue}` : "placeholder"} data-placeholder={currentValue ? undefined : ""} custom={direction} variants={reduceMotion ? valueFade : valueRoll} initial="enter" animate="center" exit="exit">{shown}</motion.span>
            </AnimatePresence>
          </span>
          <SelectPrimitive.Icon className={styles.chevron} data-rmd-part="chevron">
            <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal container={container}>
          <SelectPrimitive.Content className={styles.content} data-rmd-part="menu" position="popper" sideOffset={4} collisionPadding={12}>
            <SelectPrimitive.ScrollUpButton className={styles.scrollButton} data-rmd-part="scroll-up">
              <ChevronUp size={16} strokeWidth={1.75} aria-hidden="true" />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport className={styles.viewport} data-rmd-part="viewport">
              {options.map((option) => (
                <SelectPrimitive.Item key={option.value} value={option.value} disabled={option.disabled} className={styles.item} data-rmd-part="item">
                  <SelectPrimitive.ItemText><span className={styles.itemLabel}>{option.label}</span></SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className={styles.indicator} data-rmd-part="indicator">
                    <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className={styles.scrollButton} data-rmd-part="scroll-down">
              <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {description && <span id={hintId} className={styles.hint} data-rmd-part="hint">{description}</span>}
    </div>
  );
});
