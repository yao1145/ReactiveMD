const EXIT_CODES = `Exit codes:
  0  success
  2  usage or argument error
  3  document compile, render, React or build-artifact error
  4  input or output file I/O error
  5  asset or security policy error`;

/** @param {string} version */
export function mainHelp(version) {
  return `reactive-md ${version}

Usage:
  reactive-md build <doc.reactive.md> -o <doc.html> [options]
  reactive-md lint [--json] [--warnings-as-errors] [--locale en|zh] <file... | ->
  reactive-md build --help
  reactive-md lint --help
  reactive-md --version

Commands:
  build   Compile one local document into a single, self-contained HTML file.
  lint    Compile documents and report diagnostics.

Run "reactive-md build --help" or "reactive-md lint --help" for the options and
the document diagnostic format. "format" and "migrate" are not part of this
release.

Build ${EXIT_CODES.toLowerCase()}
Lint exit codes: 0 clean, 1 diagnostics, 2 usage or file-read error.
`;
}

export function buildHelp() {
  return `Usage: reactive-md build <doc.reactive.md> -o <doc.html> [options]

Compile one document with the packaged core, optionally validate a parameter
state file, verify and inline local images, server-render the document with
React 19, and write one UTF-8 HTML file. The output is assembled through the
same shareable-HTML shell used by the interactive runtime (CSP, escaped JSON,
notices and print styles included).

Options:
  -o, --output <file>              Output HTML path (required). The parent
                                   directory must already exist.
      --mode <interactive|static>  Output mode (default interactive). Static
                                   output has no runtime script and no
                                   auto-mount payload.
      --state-file <file.json>     Export this validated state as the baseline
                                   instead of the document's initial values.
      --assets <inline|omit>       Image handling (default inline). "omit"
                                   skips all image reads and leaves the
                                   renderer's normal alt fallback.
      --asset-root <dir>           Extra local directory that relative image
                                   URLs may resolve inside. URLs and remote
                                   image roots are not supported.
      --locale <en|zh>             UI locale (default en).
      --color-scheme <auto|light|dark>
                                   Document color scheme (default auto).
      --title <text>               Override the document title. By default the
                                   first heading is rendered as plain text, or
                                   the input file name is used.
      --strict                     Treat compile warnings as errors. With
                                   --assets omit, omitted images also fail.
  -h, --help                       Show this help.

Interactive HTML requires React 19 and react-dom, plus the prebuilt
dist-standalone IIFE. Every build requires the prebuilt dist-library artifacts.
From a source checkout, run "npm run build" before building documents.

${EXIT_CODES}
`;
}
