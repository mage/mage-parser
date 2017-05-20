import * as mage from 'mage'

export class ev {
    public static readonly HELLO = 'world'
}

export const enum events {
    Success = 5000,
    Failure,
    Dunno
}

export function emitSuccess(state: mage.core.IState) {
    const message = 'yay'
    state.emit('123', events.Success, 1)
    state.emit<string>('123', 'TESTEVENT', message)
}