<computed name="b1" value="{{ 4 / pi }}">
<computed name="b3" value="{{ terms >= 2 ? 4 / (3 * pi) : 0 }}">
<computed name="b5" value="{{ terms >= 3 ? 4 / (5 * pi) : 0 }}">
<computed name="b7" value="{{ terms >= 4 ? 4 / (7 * pi) : 0 }}">
<computed name="b9" value="{{ terms >= 5 ? 4 / (9 * pi) : 0 }}">
<computed name="b11" value="{{ terms >= 6 ? 4 / (11 * pi) : 0 }}">
<computed name="b13" value="{{ terms >= 7 ? 4 / (13 * pi) : 0 }}">
<computed name="b15" value="{{ terms >= 8 ? 4 / (15 * pi) : 0 }}">
<computed name="approx" value="{{ b1*sin(probe)+b3*sin(3*probe)+b5*sin(5*probe)+b7*sin(7*probe)+b9*sin(9*probe)+b11*sin(11*probe)+b13*sin(13*probe)+b15*sin(15*probe) }}">
<computed name="coefficient" value="{{ n % 2 == 0 ? 0 : 4 / (n * pi) }}">

# Building a square wave from sine waves

A Fourier series lesson · About 25 minutes · Assumes definite integrals

How can smooth sine curves produce the flat tops and steep edges of a square wave? Start with the graph, derive its coefficients, then return to the graph to see what improves as more terms are retained.

## Start with one period

Take a square wave of period $2\pi$:

$$ f(x)=\begin{cases}-1,&-\pi<x<0,\\1,&0<x<\pi.\end{cases} $$

Set its value at each jump to the mean of its two limits, zero, and extend periodically. The function is odd, so its Fourier expansion needs only sine terms.

<panel title="Adjust the partial sum">
<slider bind="terms" label="Nonzero terms N" initial="3" min="1" max="8">
<slider bind="probe" label="Observation point x" initial="1" min="-3" max="3" step="0.05">
</panel>

<plot min="-3.141592653589793" max="3.141592653589793" label="Square wave and Fourier partial sum" x-label="x" y-label="function value">
$$ y = \begin{cases} -1,&x<0\\0,&x=0\\1,&x>0 \end{cases} $$
$$ y = \mathrm{b1}\sin(x)+\mathrm{b3}\sin(3x)+\mathrm{b5}\sin(5x)+\mathrm{b7}\sin(7x)+\mathrm{b9}\sin(9x)+\mathrm{b11}\sin(11x)+\mathrm{b13}\sin(13x)+\mathrm{b15}\sin(15x) $$
</plot>

With {{ terms }} nonzero terms, the highest harmonic is **{{ 2 * terms - 1 }}**. At x = {{ formatNumber(probe, 2, 'en-US') }}, the partial sum is **{{ formatNumber(approx, 4, 'en-US') }}** and the square wave's value is {{ probe > 0 ? 1 : probe < 0 ? -1 : 0 }}.

Move N from 1 to 8. Look away from the jump first, then near $x=0$. The graph's endpoints display the shape within one period; the periodic joins also have jumps.

## Where do the coefficients come from?

For a function of period $2\pi$, write

$$ f(x)\sim\frac{a_0}{2}+\sum_{n=1}^{\infty}\left(a_n\cos nx+b_n\sin nx\right). $$

Multiply by $\sin(mx)$ and integrate over $[-\pi,\pi]$. Orthogonality removes every other term, giving

$$ b_n=\frac{1}{\pi}\int_{-\pi}^{\pi}f(x)\sin(nx)\,dx. $$

Since $f$ is odd and cosine is even, $a_0=a_n=0$. The product $f(x)\sin(nx)$ is even, with $f(x)=1$ on the positive half-period. Therefore,

$$
\begin{aligned}
b_n&=\frac{2}{\pi}\int_0^\pi\sin(nx)\,dx\\
&=\frac{2}{n\pi}(1-\cos n\pi)\\
&=\frac{2}{n\pi}(1-(-1)^n)\\
&=\begin{cases}\frac{4}{n\pi},&n\text{ odd},\\0,&n\text{ even}.\end{cases}
\end{aligned}
$$

<panel title="Inspect a coefficient">
<slider bind="n" label="Harmonic number n" initial="3" min="1" max="10">
Sine coefficient {{ n }} is **{{ formatNumber(coefficient, 6, 'en-US') }}**. {{ n % 2 == 0 ? 'This term is zero and is absent from the partial sum.' : 'This odd harmonic appears only when enough terms are retained.' }}
</panel>

## Put the result back on the graph

Retaining the first N nonzero terms gives

$$ S_N(x)=\frac{4}{\pi}\sum_{k=1}^{N}\frac{\sin((2k-1)x)}{2k-1}. $$

N counts nonzero terms; the highest frequency is $2N-1$. For N=3, the retained harmonics are 1, 3 and 5.

<steps label="Questions for the graph" bind="discussion">
<step label="Flat sections" value="flat">Fix x=1 and compare N=1, 3 and 8. The pointwise absolute error need not decrease after every added term, although the overall shape approaches the square wave.</step>
<step label="Jumps" value="jump">Set x=0. Every sine term vanishes here, so the series gives the mean of the left and right limits.</step>
<step label="Overshoot" value="overshoot">Inspect the peak above 1 near a jump. More terms narrow the oscillating region, but the overshoot does not disappear. This is the Gibbs phenomenon.</step>
</steps>

## Check your understanding

<quiz type="choice" label="Why is b₂ zero?" answer="even" explanation="For n=2, 1-(-1)²=0. Oddness removes cosine coefficients; the sine coefficients still need calculating.">
<option value="odd">Every sine coefficient of an odd function is zero</option>
<option value="even">Because 1-(-1)² is zero</option>
<option value="small">High-frequency terms can always be ignored</option>
</quiz>

<quiz type="number" label="What is S₈(x) at x=0?" answer="0" tolerance="0.000001" explanation="Every term contains sin((2k-1)x), which is zero at x=0.">
</quiz>

<accordion>
<disclosure label="A question to take away">
Shift the square wave to the right. Its expansion will generally contain both sine and cosine terms. Expand each shifted sine with the angle subtraction formula and identify which coefficients change.
</disclosure>
</accordion>

Reference: [MIT 18.03 lecture notes](https://math.mit.edu/~dunkel/Teach/18.03/2018_CourseNotes.pdf).
