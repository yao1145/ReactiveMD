import React from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';

const source = `# 费用估算

<panel title="调整方案">
<slider bind="people" label="人数" initial="2" min="1" max="20">
<toggle bind="annual" label="年度付款">
</panel>

每月费用：**{{ people * (annual ? 80 : 100) }} 元**。`;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <main style={{ padding: 24 }}>
      <LocalReactiveDocument source={source} />
    </main>
  </React.StrictMode>,
);
