"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatPlayersCount = exports.playersWord = void 0;
const playersWord = (count) => {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) {
        return 'игрок';
    }
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
        return 'игрока';
    }
    return 'игроков';
};
exports.playersWord = playersWord;
const formatPlayersCount = (count) => `${count} ${(0, exports.playersWord)(count)}`;
exports.formatPlayersCount = formatPlayersCount;
