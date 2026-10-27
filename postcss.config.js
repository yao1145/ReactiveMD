// Supported browsers use WOFF2. Keep one copy of each math font in the
// self-contained library/standalone CSS instead of embedding WOFF and TTF too.
export default {
  plugins: [{
    postcssPlugin: 'reactive-md-katex-fonts',
    AtRule(rule) {
      if (rule.name !== 'font-face' || !rule.nodes?.some(node =>
        node.prop === 'font-family' && node.value.includes('KaTeX_'))) return;
      rule.walkDecls('src', declaration => {
        const woff2 = declaration.value.split(/,\s*(?=url\()/)
          .find(source => /format\(["']?woff2["']?\)/.test(source));
        if (!woff2) throw declaration.error('KaTeX font is missing its WOFF2 source.');
        declaration.value = woff2;
      });
      rule.walkDecls('font-display', declaration => { declaration.value = 'swap'; });
    },
  }],
};
