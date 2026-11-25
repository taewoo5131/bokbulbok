import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * 문의 이메일. 여기 한 곳만 바꾸면 문의·개인정보처리방침 페이지에 모두 반영됩니다.
 * 비워 두면 "준비 중"으로 표시됩니다.
 */
const CONTACT_EMAIL = '';

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
  plugins: [contactEmail()],
  build: {
    rollupOptions: {
      // 여러 페이지를 함께 빌드
      input: {
        main: page('index'),
        about: page('about'),
        privacy: page('privacy'),
        contact: page('contact'),
      },
    },
  },
});
