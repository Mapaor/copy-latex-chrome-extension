// Test script for markdown2typst library
// The library exposes functions to window object, so we need to simulate that in Node.js
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read and execute the minified file in a context with window object
const libCode = readFileSync(join(__dirname, 'markdown2typst.browser.min.js'), 'utf-8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(libCode, context);

// Extract the functions from the window object
const { markdown2typst } = context.window;

// Example LaTeX equations
const examples = [
    `# Example heading

Lorem *ipsum* dolor **sic** amet

[example](https://example.com)

> This is a quote`,
    `# Testing equations
This is an $a=\\frac{b}{c}$ inline equation\n
And this is a block equation:
$$e^{i\pi}+1=0$$`
];

console.log("Markdown to Typst Conversion Test\n");
console.log("=".repeat(50));

examples.forEach((markdown, index) => {
    console.log(`\n ---------- EXAMPLE ${index + 1} ---------- `)
    console.log(`\n\nMARKDOWN: \n ${markdown}`);
    try {
        const typst = markdown2typst(markdown);
        console.log(`\n\n\n TYPST:  \n ${typst}`);
    } catch (error) {
        console.error(`   Error: \n ${error.message}`);
    }
});

console.log("\n" + "=".repeat(50));
