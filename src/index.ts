import * as ts from 'typescript'
import * as path from 'path'

const glob = require('glob')

/**
 * Type data structure
 */
type MageType = {}

/**
 * User command parameters
 */
type MageUserCommandParameter = {
  name: string, 
  type: MageType
}

/**
 * User command
 */
type MageUserCommand = {
  name: string,
  parameters: MageUserCommandParameter[],
  returnType: MageType
}

/**
 * messageStream messages (coming from `state.emit`)
 */
type MageMessage = {
  id: string,
  type: MageType
}

/**
 * MAGE module
 */
type MageModule = {
  name: string,
  types: MageType[],
  usercommands: MageUserCommand[],
  messages: MageMessage[]
}

/**
 * Internal module map used to keep track of modules by name
 */
type MageModuleMap = {
  [name: string]: MageModule
}

type UserCommandExecuteInfo = { 
  parameters: ts.Symbol[],
  returnType: ts.Type
}

export class Parser {
  // The project path
  projectPath: string;

  // Module map for quick module access while parsing
  modulesMap: MageModuleMap;
  
  // Extracted modules will be placed here
  modules: MageModule[];

  // List of all known userCommands
  userCommandFiles: string[];

  // Program instance used to extract type information
  program: ts.Program;
  
  // Type checker instacne
  checker: ts.TypeChecker;

  /**
   * Creates an instance of Parser.
   * 
   * @param {string} projectPath 
   * @param {ts.CompilerOptions} [options={
   *       target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS
   *   }] 
   * 
   * @memberof Parser
   */
  constructor(projectPath: string, options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS
  }) {
    this.projectPath = projectPath;
    
    // We only load the user command files; if they import other files 
    // (like the module files themselves), they will show up as part of the 
    // program, and we will be able to parse them
    const globPattern = path.join(this.projectPath, 'lib/modules/**/usercommands/*.ts')
    this.userCommandFiles = glob.sync(globPattern)

    // Build a program using the set of root file names in fileNames
    this.program = ts.createProgram(this.userCommandFiles, options);

    // Get the checker, we will use it to find more about classes
    this.checker = this.program.getTypeChecker();

    // Empty modules list and modules map
    this.modules = []
    this.modulesMap = {}
  }

  /**
   * Parse the project and collect all relevant information
   * 
   * @memberof Parser
   */
  public parse() {
    for (const sourceFile of this.program.getSourceFiles()) {
      try {
        this.processSourceFile(sourceFile)
      } catch (error) {
        error.message = '[' + sourceFile.fileName + '] ' + error.message
        throw error
      }
    }
  }

  /**
   * Process a source file
   * 
   * @private
   * @param {ts.SourceFile} sourceFile 
   * 
   * @memberof Parser
   */
  private processSourceFile(sourceFile: ts.SourceFile) {
    if (!this.isSourceFilePartOfaModule(sourceFile)) {
      return
    }

    // Find out module name
    const moduleName = this.extractModuleNameFromSourceFile(sourceFile);

    // Scan file for state.emit and state.broadcast calls
    const module = this.getModuleInstance(moduleName)
    this.processModuleSourceFile(module, sourceFile)

    if (!this.isUserCommandSourceFile(sourceFile)) {
      return
    }

    // If file is a usercommand file, create client endpoint
    const userCommandName = this.extractUserCommandNameFromSourceFile(sourceFile);
    this.processUserCommandSourceFile(module, userCommandName, sourceFile)
  }

  /**
   * Extract the module's name from a SourceFile instance
   * 
   * lib/modules/[moduleName]/usercommands/userCommandName
   * 
   * @private
   * @param {ts.SourceFile} sourceFile 
   * 
   * @memberof Parser
   */
  private extractModuleNameFromSourceFile(sourceFile: ts.SourceFile) {
    return this.getSourceFileNameTokens(sourceFile)[2]
  }

  /**
   * Retrieve a module instance (and create it if it does not exist)
   * 
   * @private
   * @param {string} moduleName 
   * 
   * @memberof Parser
   */
  private getModuleInstance(moduleName: string): MageModule {
    let module: MageModule | null = this.modulesMap[moduleName]

    if (!module) {
      module = <MageModule> {
        name: moduleName,
        types: [],
        usercommands: [],
        messages: []
      }

      this.modulesMap[moduleName] = module
      this.modules.push(module) 
    }
    
    return module
  }

  /**
   * Process a file that's part of a module
   * 
   * This method will extract the name and type of messageStream
   * events emitted by `state.emit` and `state.broadcast` calls.
   * 
   * Todo: state.emit.bind(...) is not supported by this code parser!
   * 
   * @private
   * @param {MageModule} module 
   * @param {ts.SourceFile} sourceFile 
   * 
   * @memberof Parser
   */
  private processModuleSourceFile(module: MageModule, sourceFile: ts.SourceFile) {
    const visit = (node: ts.Node) => {
      const iterate = () => ts.forEachChild(node, visit) 
    
      if (node.kind ===  ts.SyntaxKind.CallExpression) {
          // Get call information
          const callExpression = <ts.CallExpression>node
          const signature: ts.Signature = this.checker.getResolvedSignature(callExpression);
          const declaration = signature.declaration

          if (!declaration) {
            iterate()
            return
          }

          const parentSymbol: ts.Symbol = (<any>declaration.parent).symbol
          const isMageSymbol = this.isMageMemberSymbol(parentSymbol)
          const callName = declaration.name ? declaration.name.getText() : ''

          // Make sure the call is bound to a state object
          if (!declaration || parentSymbol.name !== 'IState' || !isMageSymbol) {
            iterate()
            return 
          }

          if (callName !== 'emit' && callName !== 'broadcast') {
            iterate()
            return
          }

          const args = callExpression.arguments.slice()
          
          // We remove the actorId parameter, we don't need it
          if (callName === 'emit') {
            args.shift()
          }
          
          // Extract event name and value
          let event, eventName, eventNameValue

          switch(args[0].kind) {
            case ts.SyntaxKind.PropertyAccessExpression: 
              event = <ts.PropertyAccessExpression>args[0]
              eventName = event.name.text
              eventNameValue = this.checker.getConstantValue(event)
              break

            case ts.SyntaxKind.NumericLiteral:
            case ts.SyntaxKind.StringLiteral:
              event = <ts.StringLiteral>args[0]
              eventName = event.text
              eventNameValue = event.text
              break

            default:
              let errorMessage = module.name 
              errorMessage += ': eventName must be either a string literal, number literal or a constant enum value, received: '
              errorMessage += node.getText()
              throw new Error(errorMessage)
          }

          // Extract event type
          const message = args[1]
          const messageType = this.checker.getContextualType(message)
          this.extractTypeToModule(module, messageType)

          // Todo: extractMessageToModule
          console.log('!!!', module.name, this.checker.signatureToString(signature), eventName, eventNameValue, messageType)
      }

      iterate()
    }

    visit(sourceFile)
  }

  /**
   * Process a user command source file
   * 
   * This method will extract the name, parameters and return value of the 
   * user command.
   * 
   * @private
   * @param {MageModule} module
   * @param {string} userCommandName
   * @param {ts.SourceFile} sourceFile 
   * 
   * @memberof Parser
   */
  private processUserCommandSourceFile(module: MageModule, userCommandName: string, sourceFile: ts.SourceFile) {
    console.log(module, userCommandName)
    const userCommandExecuteSymbol = this.getUserCommandExecuteSymbol(sourceFile)
    const {
      parameters,
      returnType
    } = this.getUserCommandExecuteInfo(userCommandExecuteSymbol)

    // Todo: extractUserCommandToModule
    parameters.forEach((parameter: ts.Symbol) => {
      if (!parameter.valueDeclaration) {
        return
      }
      
      const type = this.checker.getTypeOfSymbolAtLocation(parameter, parameter.valueDeclaration);
      console.log(parameter.getName(), this.checker.typeToString(type))
    })
          
    console.log('return', this.checker.typeToString(returnType))

    returnType.getProperties().forEach((property: ts.Symbol) => {
      if (!property.valueDeclaration) {
        return
      }
      
      const type = this.checker.getTypeOfSymbolAtLocation(property, property.valueDeclaration);
      console.log(' ', property.getName(), this.checker.typeToString(type))
    })
  }

  /**
   * Determine whether a symbol is part of MAGE's definition tree
   * 
   * If passing:
   *    
   *    - mage.something.something symbol: return true
   *    - something.unrelated: return false
   * 
   * Todo: try to find if we can identify the file of origin
   * of a given symbol instead
   * 
   * @private
   * @param {ts.Symbol} symbol 
   * @returns {boolean} 
   * 
   * @memberof Parser
   */
  private isMageMemberSymbol(symbol: ts.Symbol): boolean {
    const parentSymbol: ts.Symbol | undefined = (<any>symbol).parent

    if (!parentSymbol) {
      return symbol.name === 'mage'
    }

    return this.isMageMemberSymbol(parentSymbol)
  }

  /**
   * Retrieve the user command name from a SourceFile instance
   * 
   * lib/modules/moduleName/usercommands/[userCommandName]
   * 
   * @private
   * @param {ts.SourceFile} sourceFile 
   * @returns 
   * 
   * @memberof Parser
   */
  private extractUserCommandNameFromSourceFile(sourceFile: ts.SourceFile) {
    return this.getSourceFileNameTokens(sourceFile)[4]
  }

  /**
   * Extract the name from a source file name, and split each 
   * path segments into an array
   * 
   * @private
   * @param {ts.SourceFile} sourceFile 
   * @returns {string[]} 
   * 
   * @memberof Parser
   */
  private getSourceFileNameTokens(sourceFile: ts.SourceFile): string[] {
    return this.getSourceFileRelativePath(sourceFile).split('/')
  }

  /**
   * Check if a given file is part of a MAGE module's source code
   * 
   * @private
   * @param {ts.SourceFile} sourceFile 
   * @returns {boolean} 
   * 
   * @memberof Parser
   */
  private isSourceFilePartOfaModule(sourceFile: ts.SourceFile): boolean {
    return this.getSourceFileRelativePath(sourceFile).substring(0, 11) === 'lib/modules'
  }

  /**
   * Get the relative file path of a SourceFile instance
   * 
   * @private
   * @param {ts.SourceFile} sourceFile 
   * @returns 
   * 
   * @memberof Parser
   */
  private getSourceFileRelativePath(sourceFile: ts.SourceFile) {
    return path.relative(this.projectPath, sourceFile.fileName)    
  }

  /**
   * Check if a given SourceFile contains a user command
   * 
   * @private
   * @param {ts.SourceFile} sourceFile 
   * @returns 
   * 
   * @memberof Parser
   */
  private isUserCommandSourceFile(sourceFile: ts.SourceFile): boolean {
    return this.userCommandFiles.indexOf(sourceFile.fileName) !== -1
  }

  /**
   * Retrieve a user command's execute method from a source file
   * 
   * @private
   * @param {ts.SourceFile} sourceFile 
   * @returns {ts.Symbol} 
   * 
   * @memberof Parser
   */
  private getUserCommandExecuteSymbol(sourceFile: ts.SourceFile): ts.Symbol {
    const sourceFileSymbol: ts.Symbol = (<any>sourceFile).symbol

    if (!this.isValueModule(sourceFileSymbol)) {
      throw new Error('User command file does not appear to be a module file')
    }

    const userCommandExecuteSymbol = this.extractUserCommandExecuteSymbol(sourceFileSymbol)

    if (!userCommandExecuteSymbol) {
      throw new Error('usercommand.execute method does not seem to be exported')
    }

    return userCommandExecuteSymbol
  }
    
  /**
   * Check whether a given symbol is a ValueModule (that exports public APIs)
   * 
   * @private
   * @param {ts.Symbol} symbol 
   * @returns {boolean} 
   * 
   * @memberof Parser
   */
  private isValueModule(symbol: ts.Symbol): boolean {
    return symbol && symbol.flags === ts.SymbolFlags.ValueModule
  }

  /**
   * Extract the user command's execute Symbol representation
   * 
   * @private
   * @param {ts.Symbol} symbol 
   * @returns {(ts.Symbol | undefined)} 
   * 
   * @memberof Parser
   */
  private extractUserCommandExecuteSymbol(symbol: ts.Symbol): ts.Symbol | undefined {
    let execSymbol = this.checker.tryGetMemberInModuleExports('execute', symbol)
    
    if (!execSymbol) {
      execSymbol = this.extractUserCommandExecuteSymbolFromRequireExport(symbol)
    }

    return execSymbol
  }

  /**
   * Extract the user command's execute Symbol representation from a require export
   * 
   * This covers the case where a user command is exported in the following way:
   * 
   * ```typescript
   * export = <mage.core.IUserCommand> {
   *   acl: ['*'],
   *   execute: async function (state): Promise<string> {
   *     return 'hello'
   *   }
   * }
   * ```
   * 
   * @private
   * @param {ts.Symbol} symbol 
   * @returns {(ts.Symbol | undefined)} 
   * 
   * @memberof Parser
   */
  private extractUserCommandExecuteSymbolFromRequireExport(symbol: ts.Symbol): ts.Symbol | undefined {
    let execSymbol: ts.Symbol | undefined

    function visitNode(node: ts.Node) {
      if (execSymbol) {
        return
      } else if (node.kind === ts.SyntaxKind.PropertyAssignment) {
        const symbol: ts.Symbol = (<any>node).symbol
        
        if (symbol.valueDeclaration && symbol.name === 'execute') {
          return execSymbol = symbol
        }
      }

      ts.forEachChild(node, visitNode);
    }

    if (symbol.exports) {
      const defaultExport = symbol.exports.get('export=')
    
      if (defaultExport && defaultExport.valueDeclaration) {  
        visitNode(defaultExport.valueDeclaration)
      }
    }

    return execSymbol
  }

  // Extract the user command's parameter symbols and the return type
  private getUserCommandExecuteInfo(methodSymbol: ts.Symbol): UserCommandExecuteInfo {
    if (!methodSymbol.valueDeclaration) {
      throw new Error('valueDeclaration is not set (todo: what does it mean?)')
    }

    // We extract the methodType
    const methodType = this.checker.getTypeOfSymbolAtLocation(methodSymbol, methodSymbol.valueDeclaration);

    // Todo: Check that the method is an async method
    
    const signatures = methodType.getCallSignatures()

    if (signatures.length !== 1) {
      throw new Error('User command execute methods cannot have more than one function signature!')
    }

    const signature = signatures[0]

    // Return type is expected to be a Promise<T> - we will now extract the type of T
    const returnType: ts.Type = signature.getReturnType()
    const typeArguments: ts.Type[] = (<any>returnType).typeArguments

    if (!typeArguments || typeArguments.length !== 1) {
      throw new Error('User command execute method must specify its return type (as Promise<T> where T is an explicit type)')
    }

    return {
      parameters: signature.getParameters(), 
      returnType: typeArguments[0]
    }
  }

  /**
   * Extract type and sub-types details from a given type, and
   * add them to a given module
   * 
   * This is used to keep track of all data types used as:
   * 
   *   - input to user commands
   *   - output to state.emit and state.broadcast
   * 
   * @private
   * @param {MageModule} module 
   * @param {ts.Type} type 
   * 
   * @memberof Parser
   */
  private extractTypeToModule(module: MageModule, type: ts.Type) {
    // Todo: type extraction
    console.log(module, type)
  }
}
