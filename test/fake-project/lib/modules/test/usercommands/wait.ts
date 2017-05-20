import * as mage from 'mage'
import * as test from '..'

class B {
    constructor(a: string) {
        this.name = a;
    }
    
    name: string;
}

export = <mage.core.IUserCommand> {
    acl: ['*'],
    execute: async function (state): Promise<B> {
        test.emitSuccess(state)
        return new B('asd')
    }
}