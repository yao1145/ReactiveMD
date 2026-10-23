import type { NativeComponentDefinition } from './native-components';

export const EXTENDED_NATIVE_COMPONENTS: readonly NativeComponentDefinition[] = [
  { id: 'jump', label: 'Jump and anchor', description: 'Link to a named position in this document.', group: 'action', keywords: ['jump','anchor','navigation'],
    template: '<jump to="{{bind:destination}}" appearance="button" color="#2563eb">View results</jump>\n\n<anchor id="{{bind:destination}}">\n\n{{selection:Results appear here.}}' },
  { id: 'anchor', label: 'Anchor', description: 'Name a destination for document links.', group: 'layout', keywords: ['anchor','target','destination'],
    template: '<anchor id="{{bind:destination}}">' },
  { id: 'text', label: 'Colored text', description: 'Give selected words a foreground color.', group: 'hint', keywords: ['text','color','foreground'], inline: true,
    template: '<text color="#a2273a">{{selection:Important reminder}}</text>' },
  { id: 'section', label: 'Colored section', description: 'Apply a shared text color to several paragraphs.', group: 'layout', keywords: ['section','color','paragraph'],
    template: '<section color="#45536f">\n\n{{selection:Your paragraphs go here.}}\n\n</section>' },
  { id: 'multi-select', label: 'Multiple selection', description: 'Choose up to two items and read their values.', group: 'input', keywords: ['multiple','select','subjects','checkbox'],
    template: '<multi-select bind="{{bind:subjects}}" label="Subjects" max-selected="2">\n<option value="math">Math</option>\n<option value="physics">Physics</option>\n<option value="chemistry">Chemistry</option>\n</multi-select>' },
  { id: 'range-slider', label: 'Interval slider', description: 'Choose the lower and upper bounds of an interval.', group: 'input', keywords: ['range','interval','slider','bounds'],
    template: '<range-slider label="Interval" bind-start="{{bind:low}}" bind-end="{{bind:high}}" initial-start="20" initial-end="80" min="0" max="100" step="1">' },
  { id: 'coordinate', label: 'Coordinate point', description: 'Drag a point or change its two coordinates.', group: 'input', keywords: ['coordinate','point','drag','geometry'],
    template: '<coordinate label="Point" bind-x="{{bind:px}}" bind-y="{{bind:py}}" initial-x="1" initial-y="2" x-min="-5" x-max="5" y-min="-5" y-max="5">' },
  { id: 'quiz', label: 'Practice question', description: 'Check an answer and read a short explanation.', group: 'action', keywords: ['quiz','practice','answer','learn'],
    template: '<quiz type="choice" label="What is 2 + 3?" answer="b" explanation="The sum is 5.">\n<option value="a">4</option>\n<option value="b">5</option>\n</quiz>' },
  { id: 'steps', label: 'Guided steps', description: 'Read instructions one step at a time.', group: 'layout', keywords: ['steps','guide','previous','next'],
    template: '<steps label="Learning path" bind="{{bind:lesson}}">\n<step label="Observe">\nChange a parameter.\n</step>\n<step label="Practice">\nCheck an answer.\n</step>\n</steps>' },
];

export const EXTENDED_NATIVE_COMPONENT_COPY_ZH = {
  jump: { label: '跳转与锚点', description: '跳到当前文档中的指定位置。', keywords: ['跳转','锚点','导航'], template: '<jump to="{{bind:destination}}" appearance="button" color="#2563eb">查看结果</jump>\n\n<anchor id="{{bind:destination}}">\n\n{{selection:结果显示在这里。}}' },
  anchor: { label: '锚点', description: '为文档内的跳转指定目标位置。', keywords: ['锚点','目标','位置'], template: '<anchor id="{{bind:destination}}">' },
  text: { label: '文字颜色', description: '为选中的局部文字指定颜色。', keywords: ['文字','颜色','前景'], template: '<text color="#a2273a">{{selection:重要提醒}}</text>' },
  section: { label: '正文颜色', description: '为一段或多段正文指定统一颜色。', keywords: ['正文','段落','颜色'], template: '<section color="#45536f">\n\n{{selection:在这里填写正文。}}\n\n</section>' },
  'multi-select': { label: '多选', description: '最多选择两个选项，公开选项值数组。', keywords: ['多选','选项','主题'], template: '<multi-select bind="{{bind:subjects}}" label="主题" max-selected="2">\n<option value="math">数学</option>\n<option value="physics">物理</option>\n<option value="chemistry">化学</option>\n</multi-select>' },
  'range-slider': { label: '区间滑块', description: '同时选择区间的起点和终点。', keywords: ['区间','滑块','上下限'], template: '<range-slider label="观察区间" bind-start="{{bind:low}}" bind-end="{{bind:high}}" initial-start="20" initial-end="80" min="0" max="100" step="1">' },
  coordinate: { label: '二维坐标', description: '拖动坐标点，或直接修改两个坐标。', keywords: ['坐标','拖动','几何'], template: '<coordinate label="坐标点" bind-x="{{bind:px}}" bind-y="{{bind:py}}" initial-x="1" initial-y="2" x-min="-5" x-max="5" y-min="-5" y-max="5">' },
  quiz: { label: '练习题', description: '检查答案并阅读简短解析。', keywords: ['练习','题目','答案'], template: '<quiz type="choice" label="2 + 3 等于多少？" answer="b" explanation="相加得到 5。">\n<option value="a">4</option>\n<option value="b">5</option>\n</quiz>' },
  steps: { label: '分步阅读', description: '按顺序阅读说明，内置上一步和下一步。', keywords: ['步骤','引导','下一步'], template: '<steps label="学习路线" bind="{{bind:lesson}}">\n<step label="观察">\n调整参数。\n</step>\n<step label="练习">\n检查答案。\n</step>\n</steps>' },
};
