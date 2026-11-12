# Gallery

**English** · [中文](gallery-ch.md)

`<gallery>` and `<gallery-item>` belong to the default preset and `layoutPack`. Use the default React adapters and `reactive-md/styles.css`; no additional plugin registration is needed.

```markdown
<gallery label="Research slices" item-width="280">
<gallery-item label="01 · Notes">
Ordinary Markdown content.
</gallery-item>
<gallery-item label="02 · Results">
<card title="Analysis results">
Cards can also appear in a gallery.
</card>
</gallery-item>
</gallery>
```

- `gallery.label` is required and names the gallery visibly and accessibly.
- `item-width` defaults to 280, accepts integers from 180 to 480 and supports expressions. Items shrink in narrow containers.
- Direct children must be `gallery-item`, with at least one item. Items accept Markdown, images and nested components.
- Optional `gallery-item.label` renders as h3; long titles truncate while retaining their full text.
- Native `x mandatory` snapping and 32px edge padding align items after scrolling. Vertical wheel input scrolls horizontally and smoothly, returning control to the page at the ends.
- Buttons and arrow keys page through items; Home/End reach either end. Touch, trackpads and thumb dragging are supported.
- Static rendering and print lay out every item in a grid with complete titles and content.

Images retain the host URL policy and existing image viewer. Interaction references [UIArc Scroll Area](https://uiarc.dev/components/scroll-area), with no new runtime dependency.
