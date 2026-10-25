import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useLocalize } from './i18n';

/**
 * A Markdown image that opens its original source in a native modal dialog.
 *
 * The trigger is the original `<img>` element, so the rendered markup, URL
 * handling and loading hints stay identical to the plain image. The preview is
 * portalled into the document root only after a user opens it: the root carries
 * the theme tokens and an inline `<dialog>` inside a paragraph would break
 * server rendering and hydration.
 *
 * `static` mode always returns the plain image. In `interactive` mode the image
 * is a button only when it is not already wrapped in a Markdown link; a
 * link-wrapped image keeps the anchor's navigation and has no extra tab stop.
 */
export function ZoomableImage({
  src,
  alt,
  title,
  mode,
  rootRef,
}: {
  src: string;
  alt: string;
  title?: string;
  mode: 'interactive' | 'static';
  rootRef: RefObject<HTMLElement | null>;
}) {
  const t = useLocalize();
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const openRef = useRef(false);
  const srcRef = useRef(src);
  const [zoomable, setZoomable] = useState(false);
  const [open, setOpen] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [openedSrc, setOpenedSrc] = useState<string | null>(null);

  /** Put focus back on the trigger without scrolling the document. */
  const restoreTriggerFocus = useCallback(() => {
    const image = imageRef.current;
    if (!image || !image.isConnected) return;
    try {
      image.focus({ preventScroll: true });
    } catch {
      image.focus();
    }
  }, []);

  const finishClose = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(false);
    restoreTriggerFocus();
  }, [restoreTriggerFocus]);

  const closePreview = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog?.open) {
      try {
        dialog.close();
      } catch {
        /* A detached dialog has nothing left to close. */
      }
    }
    finishClose();
  }, [finishClose]);

  const openPreview = useCallback(() => {
    const root = rootRef.current;
    if (!root || openRef.current) return;
    setOpenedSrc(src);
    setPortalTarget(root);
    openRef.current = true;
    setOpen(true);
  }, [rootRef, src]);

  // Link-wrapped images keep anchor navigation. The check runs after mount so
  // server markup and the hydration pass stay free of interactive attributes.
  useEffect(() => {
    if (mode !== 'interactive') {
      setZoomable(false);
      closePreview();
      return;
    }
    const image = imageRef.current;
    setZoomable(image !== null && image.closest('a') === null);
  }, [mode, src, closePreview]);

  // A new source while the preview is open closes it; the old image is gone.
  useEffect(() => {
    if (srcRef.current === src) return;
    srcRef.current = src;
    if (openRef.current) closePreview();
  }, [src, closePreview]);

  // showModal gives the dialog a focus trap and an inert background. Every
  // close path calls dialog.close() explicitly, and removing an open dialog
  // from the document also closes it on unmount.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal !== 'function') {
      finishClose();
      return;
    }
    try {
      dialog.showModal();
    } catch {
      finishClose();
    }
  }, [open, finishClose]);

  const triggerProps = zoomable
    ? {
        role: 'button' as const,
        tabIndex: 0,
        'aria-haspopup': 'dialog' as const,
        'aria-label': alt ? undefined : t('View image', '查看图片'),
        'data-zoomable': 'true',
        onClick: (event: ReactMouseEvent<HTMLImageElement>) => {
          if (
            event.defaultPrevented
            || event.button !== 0
            || event.metaKey
            || event.ctrlKey
            || event.shiftKey
            || event.altKey
          ) {
            return;
          }
          if (event.currentTarget.closest('a')) return;
          openPreview();
        },
        onKeyDown: (event: ReactKeyboardEvent<HTMLImageElement>) => {
          if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
          if (event.currentTarget.closest('a')) return;
          event.preventDefault();
          openPreview();
        },
      }
    : {};

  const image = (
    <img
      ref={imageRef}
      className="md-image"
      src={src}
      alt={alt}
      title={title}
      loading="lazy"
      referrerPolicy="no-referrer"
      {...triggerProps}
    />
  );

  const previewLabel = (alt || title)
    ? t(`Image preview: ${alt || title}`, `图片预览：${alt || title}`)
    : t('Image preview', '图片预览');
  const showCaption = Boolean(alt || title);
  const distinctTitle = title && title !== alt ? title : undefined;

  return (
    <>
      {image}
      {open && portalTarget && openedSrc === src
        ? createPortal(
            <dialog
              ref={dialogRef}
              className="md-image-zoom"
              aria-label={previewLabel}
              onClose={finishClose}
              onKeyDown={(event) => {
                // This viewer has one action. Keep Tab inside it, including
                // browsers that otherwise move focus to their own chrome.
                if (event.key !== 'Tab') return;
                event.preventDefault();
                event.currentTarget.querySelector<HTMLButtonElement>('button')?.focus();
              }}
              onCancel={(event) => {
                // close() runs the same path as the close button, so focus is
                // restored after the modal is actually closed.
                event.preventDefault();
                closePreview();
              }}
              onClick={(event) => {
                if (event.target === event.currentTarget) closePreview();
              }}
            >
              <button
                type="button"
                className="md-image-zoom-close"
                aria-label={t('Close image preview', '关闭图片预览')}
                onClick={closePreview}
              >
                <span aria-hidden="true">×</span>
              </button>
              <figure className="md-image-zoom-figure">
                <img
                  className="md-image-zoom-full"
                  src={src}
                  alt={alt}
                  title={title}
                  referrerPolicy="no-referrer"
                />
                {showCaption ? (
                  <figcaption className="md-image-zoom-caption">
                    {alt ? <span>{alt}</span> : null}
                    {distinctTitle ? (
                      <span className="md-image-zoom-title">{distinctTitle}</span>
                    ) : null}
                  </figcaption>
                ) : null}
              </figure>
            </dialog>,
            portalTarget,
          )
        : null}
    </>
  );
}
