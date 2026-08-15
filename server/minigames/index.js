// Tüm minigame'ler burada kaydedilir.
// Yeni minigame eklerken: dosyayı import et + register(...) satırını ekle.
import { register, pickRandom, count } from './registry.js';
import PlaceholderGame from './PlaceholderGame.js';
import ArrowRushGame from './ArrowRushGame.js';
import ClickRushGame from './ClickRushGame.js';
import TypeRaceGame from './TypeRaceGame.js';
import NumberSortGame from './NumberSortGame.js';
import SimonSaysGame from './SimonSaysGame.js';

register(PlaceholderGame);
register(ArrowRushGame);
register(ClickRushGame);
register(TypeRaceGame);
register(NumberSortGame);
register(SimonSaysGame);
// register(SonrakiOyun);   <- sonraki minigame'ler böyle eklenecek
// ...

export { pickRandom, count };
