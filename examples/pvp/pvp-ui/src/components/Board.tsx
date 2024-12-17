import React, { useCallback, useEffect, useState } from 'react';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import {
  Backdrop,
  CircularProgress,
  Card,
  CardActions,
  CardContent,
  CardHeader,
  IconButton,
  Skeleton,
  Typography,
  TextField,
} from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import WriteIcon from '@mui/icons-material/EditNoteOutlined';
import CopyIcon from '@mui/icons-material/ContentPasteOutlined';
import StopIcon from '@mui/icons-material/HighlightOffOutlined';
import { type BBoardDerivedState, type DeployedBBoardAPI } from '@midnight-ntwrk/pvp-api';
import { useDeployedBoardContext } from '../hooks';
import { type BoardDeployment } from '../contexts';
import { type Observable } from 'rxjs';
import { ITEM, RESULT, STANCE } from '@midnight-ntwrk/pvp-contract';
import { EmptyCardContent } from './Board.EmptyCardContent';
import { LedgerState } from '@midnight-ntwrk/ledger';

/** The props required by the {@link Board} component. */
export interface BoardProps {
  /** The observable bulletin board deployment. */
  boardDeployment$?: Observable<BoardDeployment>;
}

function compute_info(bs: BBoardDerivedState | undefined, isP1: boolean): string {
  if (bs == undefined) {
    return '. . .';
  }
  const dmgs = bs.isP1 == isP1 ? bs.p1Dmg : bs.p2Dmg;
  const heroes = bs.isP1 == isP1 ? bs.p1Heroes : bs.p2Heroes;
  const info = heroes.map((hero, i) => `${item_str(hero.lhs)}+${item_str(hero.rhs)} (${Math.max(0, 300 - Number(dmgs[i]))}HP)`).join(' | ');
  const moves = bs.isP1 == isP1 ?  bs.p1Cmds : bs.p2Cmds;
  const moveInfo = moves != undefined ? moves.map((m) => m.toString()).join(",") : '?';
  return `[${moveInfo}]: ${info}`;
}

function item_str(item: ITEM): string {
  switch (item) {
    case ITEM.axe:
      return 'Axe';
    case ITEM.bow:
      return 'Bow';
    case ITEM.shield:
      return 'Shield';
    case ITEM.sword:
      return 'Sword';
    case ITEM.spear:
      return 'Spear';
    case ITEM.nothing:
      return '-';
  }
  return 'ERROR';
}

/**
 * Provides the UI for a deployed bulletin board contract; allowing messages to be posted or removed
 * following the rules enforced by the underlying Compact contract.
 *
 * @remarks
 * With no `boardDeployment$` observable, the component will render a UI that allows the user to create
 * or join bulletin boards. It requires a `<DeployedBoardProvider />` to be in scope in order to manage
 * these additional boards. It does this by invoking the `resolve(...)` method on the currently in-
 * scope `DeployedBoardContext`.
 *
 * When a `boardDeployment$` observable is received, the component begins by rendering a skeletal view of
 * itself, along with a loading background. It does this until the board deployment receives a
 * `DeployedBBoardAPI` instance, upon which it will then subscribe to its `state$` observable in order
 * to start receiving the changes in the bulletin board state (i.e., when a user posts a new message).
 */
export const Board: React.FC<Readonly<BoardProps>> = ({ boardDeployment$ }) => {
  const boardApiProvider = useDeployedBoardContext();
  const [boardDeployment, setBoardDeployment] = useState<BoardDeployment>();
  const [deployedBoardAPI, setDeployedBoardAPI] = useState<DeployedBBoardAPI>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [boardState, setBoardState] = useState<BBoardDerivedState>();
  const [messagePrompt, setMessagePrompt] = useState<string>();
  const [isWorking, setIsWorking] = useState(!!boardDeployment$);

  // Two simple callbacks that call `resolve(...)` to either deploy or join a bulletin board
  // contract. Since the `DeployedBoardContext` will create a new board and update the UI, we
  // don't have to do anything further once we've called `resolve`.
  const onCreateBoard = useCallback(() => boardApiProvider.resolve(), [boardApiProvider]);
  const onJoinBoard = useCallback(
    (contractAddress: ContractAddress) => boardApiProvider.resolve(contractAddress),
    [boardApiProvider],
  );

  // Callback to handle the posting of a message. The message text is captured in the `messagePrompt`
  // state, and we just need to forward it to the `post` method of the `DeployedBBoardAPI` instance
  // that we received in the `deployedBoardAPI` state.
  const onPostCommands = useCallback(async () => {
    console.log(`onPostCommands(${messagePrompt})`);
    if (!messagePrompt || messagePrompt.length != 3) {
      console.log(`invalid command [1]: ${messagePrompt}`);
      return;
    }
    // TODO: real input, for now 111, 123, 323, etc
    let commands = [];
    for (let i = 0; i < 3; ++i) {
      const j = BigInt(messagePrompt.charAt(i));
      if (j < 1 || j > 3) {
        console.log(`invalid command [2.${i}.${j}]: ${messagePrompt}`);
        return;
      }
      //commands.push({ attack: j - BigInt(1), stance: STANCE.neutral })
      commands.push(j - BigInt(1));
    }

    try {
      if (deployedBoardAPI) {
        setIsWorking(true);
        if (boardState?.isP1) {
          let res = await deployedBoardAPI.p1Command(commands);
          console.log(`p1Command: ${JSON.stringify(res)}`);
        } else {
          let res = await deployedBoardAPI.p2Command(commands);
          console.log(`p2Command: ${JSON.stringify(res)}`);
        }
      }
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsWorking(false);
    }
  }, [deployedBoardAPI, setErrorMessage, setIsWorking, messagePrompt]);

  const onCopyContractAddress = useCallback(async () => {
    if (deployedBoardAPI) {
      await navigator.clipboard.writeText(deployedBoardAPI.deployedContractAddress);
    }
  }, [deployedBoardAPI]);

  // Subscribes to the `boardDeployment$` observable so that we can receive updates on the deployment.
  useEffect(() => {
    if (!boardDeployment$) {
      return;
    }

    const subscription = boardDeployment$.subscribe(setBoardDeployment);

    return () => {
      subscription.unsubscribe();
    };
  }, [boardDeployment$]);

  // Subscribes to the `state$` observable on a `DeployedBBoardAPI` if we receive one, allowing the
  // component to receive updates to the change in contract state; otherwise we update the UI to
  // reflect the error was received instead.
  useEffect(() => {
    if (!boardDeployment) {
      return;
    }
    if (boardDeployment.status === 'in-progress') {
      return;
    }

    setIsWorking(false);

    if (boardDeployment.status === 'failed') {
      setErrorMessage(
        boardDeployment.error.message.length ? boardDeployment.error.message : 'Encountered an unexpected error.',
      );
      return;
    }

    // We need the board API as well as subscribing to its `state$` observable, so that we can invoke
    // the `post` and `takeDown` methods later.
    setDeployedBoardAPI(boardDeployment.api);
    const subscription = boardDeployment.api.state$.subscribe(setBoardState);
    return () => {
      subscription.unsubscribe();
    };
  }, [boardDeployment, setIsWorking, setErrorMessage, setDeployedBoardAPI]);

  return (
    <Card sx={{ position: 'relative', width: 320, height: 480, minWidth: 320, minHeight: 480 }} color="primary">
      {!boardDeployment$ && (
        <EmptyCardContent onCreateBoardCallback={onCreateBoard} onJoinBoardCallback={onJoinBoard} />
      )}

      {boardDeployment$ && (
        <React.Fragment>
          <Backdrop
            sx={{ position: 'absolute', color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }}
            open={isWorking}
          >
            <CircularProgress data-testid="board-working-indicator" />
          </Backdrop>
          <Backdrop
            sx={{ position: 'absolute', color: '#ff0000', zIndex: (theme) => theme.zIndex.drawer + 1 }}
            open={!!errorMessage}
          >
            <StopIcon fontSize="large" />
            <Typography component="div" data-testid="board-error-message">
              {errorMessage}
            </Typography>
          </Backdrop>
          <CardHeader
            avatar={
              boardState ? (
                  <LockOpenIcon data-testid="post-unlocked-icon" />
              ) : (
                <Skeleton variant="circular" width={20} height={20} />
              )
            }
            titleTypographyProps={{ color: 'primary' }}
            title={toShortFormatContractAddress(deployedBoardAPI?.deployedContractAddress) ?? 'Loading...'}
            action={
              deployedBoardAPI?.deployedContractAddress ? (
                <IconButton title="Copy contract address" onClick={onCopyContractAddress}>
                  <CopyIcon fontSize="small" />
                </IconButton>
              ) : (
                <Skeleton variant="circular" width={20} height={20} />
              )
            }
          />
          <CardContent>
            <Typography data-testid="board-posted-message" minHeight={48} color="primary">
              {compute_info(boardState, true)}
            </Typography>
          </CardContent>
          <CardContent>
            {boardState ? (
              boardState.state === RESULT.waiting ? (
                <Typography data-testid="board-posted-message" minHeight={160} color="primary">
                  {"Waiting on opponent"}
                </Typography>
              ) : (<React.Fragment>
                <TextField
                  id="message-prompt"
                  data-testid="board-message-prompt"
                  variant="outlined"
                  focused
                  fullWidth
                  multiline
                  minRows={6}
                  maxRows={6}
                  placeholder="Moves e.g. 121, 123, 331, etc"
                  size="small"
                  color="primary"
                  inputProps={{ style: { color: 'black' } }}
                  onChange={(e) => {
                    setMessagePrompt(e.target.value);
                  }}
                />
                <IconButton
                title="Post Move"
                data-testid="board-post-message-btn"
                disabled={boardState?.state != RESULT.continue}
                onClick={onPostCommands}
              >
                <WriteIcon />
              </IconButton></React.Fragment>
              )
            ) : (
              <Skeleton variant="rectangular" width={285} height={160} />
            )}
          </CardContent>
          <CardContent>
            <Typography data-testid="board-posted-message" minHeight={48} color="primary">
              {compute_info(boardState, false)}
            </Typography>
          </CardContent>
        </React.Fragment>
      )}
    </Card>
  );
};

/** @internal */
const toShortFormatContractAddress = (contractAddress: ContractAddress | undefined): JSX.Element | undefined =>
  // Returns a new string made up of the first, and last, 8 characters of a given contract address.
  contractAddress ? (
    <span data-testid="board-address">
      0x{contractAddress?.replace(/^[A-Fa-f0-9]{6}([A-Fa-f0-9]{8}).*([A-Fa-f0-9]{8})$/g, '$1...$2')}
    </span>
  ) : undefined;
