import http from 'node:http';

http.get('http://127.0.0.1:8787/api/book/read?book=dau-pha-thuong-khung-luc-tran&rel=chapters/%E5%8D%B701/0202-huyet-chien-bien-gioi-nu-vuong-xuat-the.md', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('Status:', res.statusCode);
      console.log('Filename:', json.rel);
      console.log('Content length:', json.content ? json.content.length : 0);
      console.log('Snippet:\n', (json.content || '').slice(0, 300));
    } catch (e) {
      console.error('Parse error:', e.message, data.slice(0, 200));
    }
  });
});
