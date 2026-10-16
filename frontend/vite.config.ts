import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({plugins:[react()], build:{target:'es2022',assetsInlineLimit:0}, server:{port:18793,
  allowedHosts:['.trycloudflare.com'],
  proxy:{'/api':{target:'http://127.0.0.1:18791',changeOrigin:true,
    configure(proxy){proxy.on('proxyReq',request=>request.setHeader('Origin','http://127.0.0.1:18791'));}}}}});
