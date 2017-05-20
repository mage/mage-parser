mage-parser
===========

** Under active development **

Parser module for TypeScript MAGE projects, used to extract user commands and messageStream messages.

This module can be used to build language-specific client generators; it will take care of extracting:

  - All types relevant to client applications
  - All usercommands, per modules
  - All messageStream messages (by finding all occurences of `state.emit` and `state.broadcast`)

Generators using mage-parser
----------------------------

| name                         | description                               | link                                                      |
| ---------------------------- | ----------------------------------------- | --------------------------------------------------------- |
| mage-unity-client-generator  | Client generator for the Unity framework  | https://www.npmjs.com/package/mage-unity-client-generator |

Feel free to make a pull request to add new client generators!

Installation
------------

```shell
npm install --save mage-parser
```

Usage
-----

```javascript
const {
    Parser
} = require('mage-parser')

const parser = new Parser('/path/to/mage/project')
const modules = parser.parse()

modules.forEach(function (module) {
  console.log(module)
})
```

This should output something similar to:

```json
{
  "name": "myModule",
  "types": [

  ],
  "usercommands": [

  ],
  "messages": [

  ]
}
```

Each modules will contain the following entries:

  - *types*: containing the different types which may be returned by the module
  - *usercommands*: containing each user commands exposed by the module
  - *messages*: containing the details for each message that can be emitted through messageStream

Command-line tool
-----------------

This module comes with a small binary that will parse a MAGE project, and output
the information it has extracted:

```shell
$ mage-parse
Usage: mage-parse /path/to/mage/project
```

You can use it to quickly show relevant information about your MAGE project.

Limitations
-----------

### Extract built-in modules

This simply cannot be done reliably, since we won't be able to parse
for messageStream events. 

### Extract JavaScript types or modules

This can be done reliably, as long as:

  - The concerned module contains a TypeScript type definition file
  - The concerned module does not emit messageStream events

### state.emit and state.broadcast

The event name passed to `state.emit` and `state.broadcast` must be one of
the following:

  - a const enum value
  - a string or number literal 

> lib/modules/test/index.ts

```typescript
import * as mage from 'mage'

const eventName = 'bad'

export const enum events {
    Success = 5000,
    Failure,
    Dunno
}

export function emitSuccess(state: mage.core.IState, message: string) {
    state.broadcast(events.Success, message) // All good
    state.broadcast('TESTEVENT', message) // All good
    state.broadcast(eventName, message) // Will blow up
}
```

The reason for this is that only the following two types' values may safely be
extracted at compile time by the TypeScript compiler.

License
-------

MIT.
