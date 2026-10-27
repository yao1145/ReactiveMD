import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from '../../src/react/index';
import { compileLocal } from '../../src/index';
import '../../src/styles.css';

const source = String.raw`# Math and chemistry

$$\begin{aligned}A&=\begin{pmatrix}1&2\\3&4\end{pmatrix}\\B&=\begin{bmatrix}a&b\\c&d\end{bmatrix}\end{aligned}$$

$$\begin{vmatrix}a&b\\c&d\end{vmatrix}=ad-bc$$

$$\begin{align}a+b&=b+c\\d&=e+f\end{align}$$

$$\mathbb{R}\quad\mathcal{F}\quad\mathscr{L}\quad\mathfrak{g}\quad\textbf{Bold}$$

$$\underbrace{a+b+c}_{n}\quad\binom{n}{k}\quad\boxed{\frac{a}{b}}$$

$$A\xrightarrow[below]{above}B\xrightleftharpoons[k_2]{k_1}C$$

$$\left\lfloor\frac{x}{2}\right\rfloor+\Bigg(\frac ab\Bigg)\quad\overrightarrow{AB}$$

$$E=mc^2\tag{1}$$

Water: $ \ce{H2O} $, sulfate: $\ce{SO4^2-}$, isotope: $\ce{^{14}_{6}C}$.

$$\ce{2 H2 + O2 -> 2 H2O}$$

$$\ce{A <=>[forward][reverse] B}$$

$$\ce{Ca(OH)2 + 2 HCl -> CaCl2 + 2 H2O}$$
`;

Object.assign(window, {mathDiagnostics: compileLocal(source).diagnostics});
createRoot(document.getElementById('root')!).render(createElement(LocalReactiveDocument, {source}));
