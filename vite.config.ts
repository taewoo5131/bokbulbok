import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * 문의 이메일. 여기 한 곳만 바꾸면 문의·개인정보처리방침 페이지에 모두 반영됩니다.
 * 비워 두면 "준비 중"으로 표시됩니다.
 */
const CONTACT_EMAIL = '';

/** 개발 서버에서도 배포와 같은 깔끔한 주소(/race, /about …)가 열리게 */
function cleanUrls(): Plugin {
  const pages = new Set(['/race', '/about', '/contact', '/privacy']);
  return {
    name: 'clean-urls',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [path, query] = (req.url ?? '').split('?');
        if (pages.has(path)) req.url = `${path}.html${query ? `?${query}` : ''}`;
        next();
      });
    },
  };
}

function contactEmail(): Plugin {
  const html = CONTACT_EMAIL
    ? `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`
    : '준비 중입니다';
  return {
    name: 'contact-email',
    transformIndexHtml: (source) => source.replaceAll('%CONTACT_HTML%', html),
  };
}

const page = (name: string) => resolve(import.meta.dirname, `${name}.html`);

export default defineConfig({
  plugins: [contactEmail(), cleanUrls()],
  build: {
    rollupOptions: {
      // 여러 페이지를 함께 빌드
      input: {
        main: page('index'),
        race: page('race'),
        about: page('about'),
        privacy: page('privacy'),
        contact: page('contact'),
      },
    },
  },
});
