const { JSDOM } = require('jsdom');

const htmlText = `
<html><body>
<table border=0 cellpadding=0 cellspacing=0 width=64 style='border-collapse:
 collapse;width:48pt'>
 <tr height=20 style='height:15.0pt'>
  <td height=20 class=xl65 width=64 style='height:15.0pt;width:48pt;background:#FFC000'>Hello</td>
 </tr>
</table>
</body></html>
`;

const dom = new JSDOM(htmlText);
const doc = dom.window.document;
const rows = doc.querySelectorAll('tr');
rows.forEach((tr, r) => {
  const tds = tr.querySelectorAll('td, th');
  tds.forEach((td, c) => {
    console.log(r, c, "bg:", td.style.backgroundColor, "background:", td.style.background, "attr:", td.getAttribute('style'));
  });
});
