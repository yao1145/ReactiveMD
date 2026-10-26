import type { ImageAssetErrorCode } from './image-assets';

export const IMAGE_COPY = {
  en: {
    title: 'Document images', add: 'Add images', choose: 'Choose file', replace: 'Replace', remove: 'Remove',
    hint: 'Choose images or paste them into the source editor. PNG, JPEG, GIF or WebP; 8 MiB each, 24 MiB total, up to 64 files. Images stay in this browser and are embedded in HTML exports.',
    missing: 'File needed', ready: 'Ready', unused: 'Not referenced', loading: 'Reading images…',
    storage: 'Images could not be saved in this browser. Export HTML before leaving or refreshing the page.',
    errors: {
      empty: 'The image file is empty.', type: 'Choose a PNG, JPEG, GIF or WebP image whose contents match its type. SVG is not supported.',
      size: 'Each image must be 8 MiB or smaller.', total: 'Document images must total 24 MiB or less.',
      count: 'A document can have at most 64 image resources.', invalid: 'The image resource is invalid. Choose the file again.',
      decode: 'The image cannot be decoded. Choose a valid image file.', read: 'The image could not be read. Choose the file again.',
    } satisfies Record<ImageAssetErrorCode | 'decode' | 'read', string>,
    summary: (ready: number, total: number) => `${ready} of ${total} image references ready to embed.`,
    removeLabel: (url: string) => `Remove ${url}`,
    chooseLabel: (url: string) => `Choose image for ${url}`,
    replaceLabel: (url: string) => `Replace image for ${url}`,
  },
  zh: {
    title: '文档图片', add: '添加图片', choose: '选择文件', replace: '替换', remove: '移除',
    hint: '选择图片，或直接粘贴到源码编辑器。支持 PNG、JPEG、GIF、WebP；单张不超过 8 MiB、合计 24 MiB、最多 64 项。图片保存在当前浏览器中，导出 HTML 时一并内嵌。',
    missing: '待补充文件', ready: '已就绪', unused: '未引用', loading: '正在读取图片…',
    storage: '当前浏览器无法保存图片。离开或刷新页面前，请先导出 HTML。',
    errors: {
      empty: '图片文件为空。', type: '请选择文件内容与类型一致的 PNG、JPEG、GIF 或 WebP 图片，不支持 SVG。',
      size: '单张图片不能超过 8 MiB。', total: '文档图片合计不能超过 24 MiB。',
      count: '每份文档最多保存 64 项图片资源。', invalid: '图片资源无效，请重新选择文件。',
      decode: '图片无法解码，请选择有效的图片文件。', read: '无法读取图片，请重新选择文件。',
    } satisfies Record<ImageAssetErrorCode | 'decode' | 'read', string>,
    summary: (ready: number, total: number) => `${total} 个图片引用中有 ${ready} 个已可内嵌。`,
    removeLabel: (url: string) => `移除 ${url}`,
    chooseLabel: (url: string) => `为 ${url} 选择图片`,
    replaceLabel: (url: string) => `替换 ${url} 的图片`,
  },
};
