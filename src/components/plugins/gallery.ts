import { GalleryView, GalleryItemView } from '../gallery/gallery';
import { selectOfficialPreset } from '../../presets/plugin-packs';
import { mountOfficialPreset } from '../mount-preset';
import galleryCss from '../gallery/gallery.css?inline';

const views = {
  gallery: GalleryView,
  'gallery-item': GalleryItemView,
};
const preset = selectOfficialPreset('reactive-md/gallery', Object.keys(views));

export default mountOfficialPreset(preset, views, [
  { id: 'reactive-md/gallery.css', css: galleryCss },
]);
