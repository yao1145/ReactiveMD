import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from '../../src/react/index';
import '../../src/styles.css';

const colorScheme = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
const short = '悬停或聚焦查看提示。';
const long = `${short.repeat(12)} LongUnbrokenText${'a'.repeat(100)}`;
document.body.style.background = colorScheme === 'dark' ? '#121212' : '#f4f4f2';
createRoot(document.getElementById('root')!).render(<>
  {['middle', 'left', 'right', 'long'].map(position => <section key={position} className={`slot ${position}`}>
    <LocalReactiveDocument
      source={`用 <tooltip text="${position === 'long' ? long : short}">提示</tooltip>说明。`}
      colorScheme={colorScheme}
    />
  </section>)}
  <section className="static"><LocalReactiveDocument source={`<tooltip text="${short}">静态提示</tooltip>`} colorScheme={colorScheme} mode="static" /></section>
</>);
