import './style.css';
import { mount } from './ui/app';

const root = document.querySelector('#app');
if (!root) throw new Error('Missing #app');
mount(root);
