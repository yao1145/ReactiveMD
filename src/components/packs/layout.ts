import { layoutPack } from '../../presets/packs';
import { AccordionView, AlertView, AnchorView, BadgeView, CardView, ColumnView, DisclosureView,
  GridView, IfView, JumpView, PanelView, SectionView, StepsView, StepView, TabsView, TabView,
  TextView, TooltipView, ValidationView } from '../layout/layout';
import { GalleryView, GalleryItemView } from '../gallery/gallery';
import { mountOfficialPreset } from '../mount-preset';
import galleryCss from '../gallery/gallery.css?inline';
import layoutCss from './layout.css?inline';

export const layoutReactPack = mountOfficialPreset(layoutPack, {
  jump: JumpView, anchor: AnchorView, text: TextView, section: SectionView, panel: PanelView,
  card: CardView, grid: GridView, column: ColumnView, tabs: TabsView, tab: TabView,
  steps: StepsView, step: StepView, accordion: AccordionView, disclosure: DisclosureView,
  if: IfView, alert: AlertView, badge: BadgeView, tooltip: TooltipView, validation: ValidationView,
  gallery: GalleryView, 'gallery-item': GalleryItemView,
}, [
  { id: 'reactive-md/gallery.css', css: galleryCss },
  { id: 'reactive-md/layout.css', css: layoutCss },
]);
export default layoutReactPack;
