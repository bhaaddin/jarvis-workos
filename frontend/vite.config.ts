import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({plugins:[react(),tailwindcss()], build:{target:'es2022',assetsInlineLimit:0}, server:{port:18793,
  proxy:{'/api':{target:'http://127.0.0.1:18791',changeOrigin:true,
    configure(proxy){proxy.on('proxyReq',request=>request.setHeader('Origin','http://127.0.0.1:18791'));}}}}});
