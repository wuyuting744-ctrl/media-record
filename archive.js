/* Animate newly visible records once; never affect drag transforms or data. */
(() => {
 const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
 const seen = new WeakSet();
 const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
   if (!entry.isIntersecting) return;
   const card = entry.target;
   observer.unobserve(card);
   if (reduce.matches || card.closest('.manage-mode')) return;
   card.classList.add('archive-reveal');
   card.addEventListener('animationend', () => card.classList.remove('archive-reveal'), {once:true});
  });
 }, {threshold:0.06});
 const scan = () => document.querySelectorAll('#cardsGrid .card').forEach((card,i) => {
  if (seen.has(card)) return;
  seen.add(card);
  card.style.setProperty('--reveal-delay', `${Math.min(i % 8, 5) * 35}ms`);
  observer.observe(card);
 });
 const grid = document.getElementById('cardsGrid');
 new MutationObserver(scan).observe(grid, {childList:true,subtree:true});
 scan();
 document.querySelectorAll('button[title]').forEach(button => {
  if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label',button.title);
 });
 document.querySelectorAll('.view-btn').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.view-btn').forEach(item => item.setAttribute('aria-pressed',String(item===button)));
 }));
 document.querySelectorAll('.view-btn').forEach(button => button.setAttribute('aria-pressed',String(button.classList.contains('active'))));
})();
