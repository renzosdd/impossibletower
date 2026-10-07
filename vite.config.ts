import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { legalPages } from './build/legalPages';
import process from 'node:process';
export default defineConfig({
 plugins:[legalPages(),VitePWA({registerType:'autoUpdate',includeAssets:['icon.svg','icon-192.png','icon-512.png','apple-touch-icon.png'],manifest:{name:'Impossible Tower',short_name:'Tower',description:'Soltá lo inesperado. Apilá lo imposible.',theme_color:'#172e38',background_color:'#172e38',display:'standalone',orientation:'portrait',start_url:'.',scope:'.',icons:[{src:'icon-192.png',sizes:'192x192',type:'image/png'},{src:'icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'icon-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}]},workbox:{globPatterns:['**/*.{js,css,html,png,svg,woff2}'],maximumFileSizeToCacheInBytes:2200000,navigateFallback:'index.html',navigateFallbackDenylist:[/^\/(en\/)?(privacidad|terminos|reglas-ranking)(\/|$)/]}})],
 define:{'import.meta.env.VITE_AD_DEPLOY_CONTEXT':JSON.stringify(process.env.CONTEXT === 'deploy-preview' ? 'deploy-preview' : 'production')},
 build:{rollupOptions:{output:{manualChunks:{phaser:['phaser'],physics:['matter-js'],supabase:['@supabase/supabase-js']}}},chunkSizeWarningLimit:1600},
 test:{include:['tests/unit/**/*.test.ts'],environment:'node'}
});
