// Test script for tex2typst library
// The library exposes functions to window object, so we need to simulate that in Node.js
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read and execute the minified file in a context with window object
const libCode = readFileSync(join(__dirname, 'tex2typst.min.js'), 'utf-8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(libCode, context);

// Extract the functions from the window object
const { tex2typst, typst2tex } = context.window;

// Example LaTeX equations
const examples = [
    "e^{i\\pi}+1=0",
    "\\frac{a}{b}",
    "\\sum_{i=1}^{n} x_i",
    "\\int_0^\\infty e^{-x^2} dx"
];

console.log("LaTeX to Typst Conversion Test\n");
console.log("=".repeat(50));

examples.forEach((latex, index) => {
    console.log(`\n${index + 1}. LaTeX:  ${latex}`);
    try {
        const typst = tex2typst(latex);
        console.log(`   Typst:  ${typst}`);
    } catch (error) {
        console.error(`   Error: ${error.message}`);
    }
});

console.log("\n" + "=".repeat(50));



// Example usage from README
// import { tex2typst, typst2tex } from 'tex2typst';

// let tex = "e \\overset{\\text{def}}{=} \\lim_{{n \\to \\infty}} \left(1 + \\frac{1}{n}\\right)^n";
// let typst = tex2typst(tex);
// console.log(typst);
// // e eq.def lim_(n -> infinity) (1 + 1/n)^n

// let tex_recovered = typst2tex(typst);
// console.log(tex_recovered);
// // e \overset{\text{def}}{=} \lim_{n \rightarrow \infty} \left(1 + \frac{1}{n} \right)^n