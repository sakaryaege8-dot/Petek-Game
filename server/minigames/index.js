// Tüm minigame'ler burada kaydedilir.
// Yeni minigame eklerken: dosyayı import et + register(...) satırını ekle.
import { register, pickRandom, count, list } from './registry.js';
import ArrowRushGame from './ArrowRushGame.js';
import ClickRushGame from './ClickRushGame.js';
import TypeRaceGame from './TypeRaceGame.js';
import NumberSortGame from './NumberSortGame.js';
import SimonSaysGame from './SimonSaysGame.js';
import UndercoverGame from './UndercoverGame.js';
import PrecisionBarGame from './PrecisionBarGame.js';
import RedButtonGame from './RedButtonGame.js';
import TimeTargetGame from './TimeTargetGame.js';

register(ArrowRushGame);
register(ClickRushGame);
register(TypeRaceGame);
register(NumberSortGame);
register(SimonSaysGame);
register(UndercoverGame);
register(PrecisionBarGame);
register(RedButtonGame);
register(TimeTargetGame);
// register(SonrakiOyun);   <- sonraki minigame'ler böyle eklenecek
// ...

export { pickRandom, count, list };
