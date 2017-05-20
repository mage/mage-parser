Contributing
============

Setup
-----

```shell
# Make sure to fork!
git clone ... mage-parser
cd  mage-parser
npm install
npm run build
```

Testing
-------

A test fake project is included in this git repository. To test
the current code (by using the `mage-parser` binary):

```shell
npm run install-test
npm run test
```

Development (VS Code)
----------------------

Open the integrated terminal, then run:

```shell
npm run watch
```

Now, the project will automatically be recompiled whenever
the TypeScript source files change.

From there, simply go on the "Debug" tab
of your VS Code editor. You should also
be able to set up breakpoint and use the debug console, 
but keep in mind that the code may take a moment
to recompile.
