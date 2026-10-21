import type { Capability, Json } from 'reactive-md';

const catalog: Json[] = [
  { name: '输入', category: '表单', description: '文本、数字、日期和多行输入' },
  { name: '图表', category: '视觉', description: '柱形、折线、面积、散点与环形图' },
  { name: '图解', category: '视觉', description: '可选择节点的交互图解' },
  { name: '表单', category: '表单', description: '字段校验和声明式提交' },
  { name: '集合', category: '数据', description: '动态列表、清单和数据表格' },
];

/** A real, cancellable local service boundary; it never contacts an AI provider. */
export const demoCapabilities: Record<string, Capability> = {
  'catalog.search': (input, { signal }) => new Promise<Json>((resolve, reject) => {
    const object = input !== null && !Array.isArray(input) && typeof input === 'object' ? input : {};
    const query = String(object.query ?? '').trim().toLocaleLowerCase('zh-CN');
    let timer: ReturnType<typeof setTimeout>;
    const abort = () => { clearTimeout(timer); reject(new DOMException('查询已取消', 'AbortError')); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      if (query === 'error') { reject(new Error('示例服务异常：请换一个关键词重试。')); return; }
      resolve(catalog.filter(item => JSON.stringify(item).toLocaleLowerCase('zh-CN').includes(query)));
    }, 650);
  }),
};
