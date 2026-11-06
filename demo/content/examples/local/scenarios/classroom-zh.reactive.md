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

# 用正弦波拼出一个方波

傅里叶级数小课堂 · 约 25 分钟 · 需要定积分基础

一条光滑的正弦曲线，怎样拼出平顶、陡边的方波？先看曲线，再推导每一项前面的系数。最后回到图上，检查项数增加后，哪些地方变好了，哪些地方仍然有振荡。

## 先看一个周期

我们研究周期为 $2\pi$ 的方波。在一个周期内：

$$ f(x)=\begin{cases}-1,&-\pi<x<0,\\1,&0<x<\pi.\end{cases} $$

在跳跃点取左右极限的平均值 0，再作周期延拓。这个函数是奇函数，因此可以只用正弦项展开。

<panel title="调整部分和">
<slider bind="terms" label="保留的非零项数 N" initial="3" min="1" max="8">
<slider bind="probe" label="观察位置 x" initial="1" min="-3" max="3" step="0.05">
</panel>

<plot min="-3.141592653589793" max="3.141592653589793" label="方波与傅里叶部分和" x-label="x" y-label="函数值">
$$ y = \begin{cases} -1,&x<0\\0,&x=0\\1,&x>0 \end{cases} $$
$$ y = \mathrm{b1}\sin(x)+\mathrm{b3}\sin(3x)+\mathrm{b5}\sin(5x)+\mathrm{b7}\sin(7x)+\mathrm{b9}\sin(9x)+\mathrm{b11}\sin(11x)+\mathrm{b13}\sin(13x)+\mathrm{b15}\sin(15x) $$
</plot>

当前保留 {{ terms }} 个非零项，最高谐波为 **{{ 2 * terms - 1 }}** 次。在 x = {{ formatNumber(probe, 2, 'zh-CN') }} 处，部分和为 **{{ formatNumber(approx, 4, 'zh-CN') }}**，方波取值为 {{ probe > 0 ? 1 : probe < 0 ? -1 : 0 }}。

把 N 从 1 慢慢调到 8。先看远离跳跃的位置，再看 $x=0$ 附近。图中的端点显示一个周期内的曲线；周期拼接处同样存在跳跃。

## 系数从哪里来

周期为 $2\pi$ 的傅里叶展开写作

$$ f(x)\sim\frac{a_0}{2}+\sum_{n=1}^{\infty}\left(a_n\cos nx+b_n\sin nx\right). $$

利用三角函数在 $[-\pi,\pi]$ 上的正交性，将两边乘以 $\sin(mx)$ 后积分，除第 $m$ 项外的积分都为零，便得到

$$ b_n=\frac{1}{\pi}\int_{-\pi}^{\pi}f(x)\sin(nx)\,dx. $$

$f$ 是奇函数，余弦是偶函数，所以 $a_0=a_n=0$。而 $f(x)\sin(nx)$ 是偶函数，正半周期内 $f(x)=1$，于是

$$
\begin{aligned}
b_n&=\frac{2}{\pi}\int_0^\pi \sin(nx)\,dx\\
&=\frac{2}{n\pi}\left(1-\cos n\pi\right)\\
&=\frac{2}{n\pi}\left(1-(-1)^n\right)\\
&=\begin{cases}\frac{4}{n\pi},&n\text{ 为奇数},\\0,&n\text{ 为偶数}.\end{cases}
\end{aligned}
$$

<panel title="检查一个系数">
<slider bind="n" label="谐波编号 n" initial="3" min="1" max="10">
第 {{ n }} 个正弦系数为 **{{ formatNumber(coefficient, 6, 'zh-CN') }}**。{{ n % 2 == 0 ? '这一项为零，不进入上方的部分和。' : '它属于奇次谐波；保留到这一阶时才进入部分和。' }}
</panel>

## 把结果写回曲线

只保留前 N 个非零项：

$$ S_N(x)=\frac{4}{\pi}\sum_{k=1}^{N}\frac{\sin((2k-1)x)}{2k-1}. $$

N 数的是非零项，最高频率是 $2N-1$。例如 N=3 时，实际保留的是 1、3、5 次谐波。

<steps label="带着问题观察" bind="discussion">
<step label="平顶" value="flat">固定 x=1，比较 N=1、3、8 的数值。误差的绝对值不一定随每次加项都减小，但整体形状会逐渐接近方波。</step>
<step label="跳跃" value="jump">把观察位置调到 0。每一个正弦项在这里都为零，级数收敛到左右极限的平均值。</step>
<step label="过冲" value="overshoot">看跳跃附近超过 1 的小峰。增加项数会让振荡区域变窄，过冲高度不会随项数增加而消失，这就是 Gibbs 现象。</step>
</steps>

## 用两道题检查理解

<quiz type="choice" label="为什么 b₂ 等于零？" answer="even" explanation="代入 n=2，1-(-1)²=0。奇函数只说明余弦系数为零，还需要计算正弦系数。">
<option value="odd">因为奇函数的所有正弦系数都为零</option>
<option value="even">因为 1-(-1)² 等于零</option>
<option value="small">因为高频项总是可以忽略</option>
</quiz>

<quiz type="number" label="在 x=0 处，S₈(x) 等于多少？" answer="0" tolerance="0.000001" explanation="每一项都含 sin((2k-1)x)，在 x=0 处全为零。">
</quiz>

<accordion>
<disclosure label="课后再想一步">
如果把整个方波向右平移，展开式里通常会同时出现正弦项和余弦项。可以先用和差公式展开每个平移后的正弦项，再观察平移改变了哪些系数。
</disclosure>
</accordion>

参考：[MIT 18.03 课程讲义](https://math.mit.edu/~dunkel/Teach/18.03/2018_CourseNotes.pdf)。
