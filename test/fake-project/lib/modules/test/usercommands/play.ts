import * as mage from 'mage'

export const acl = ['*']

class A {
    constructor(a: string) {
        this.name = a;
    }
    
    name: string;
    password: string;
    count: number;
}

export const execute = async function(state: mage.core.IState, a: string) {
    mage.auth.loginAnonymous(state, {
        acl: ['user']
    })

    return new A(a)
}

